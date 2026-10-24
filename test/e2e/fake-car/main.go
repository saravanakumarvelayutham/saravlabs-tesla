// Fake car for the end-to-end test. It connects to a real tesla/fleet-telemetry server the way a
// car does (mTLS websocket, client certificate whose CN is the VIN) and sends the steps of a JSON
// scenario as flatbuffers envelopes around protobuf payloads, built with fleet-telemetry's own
// packages so the wire format is the server's, not ours.
package main

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"time"

	"github.com/gorilla/websocket"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/teslamotors/fleet-telemetry/messages"
	"github.com/teslamotors/fleet-telemetry/messages/tesla"
	"github.com/teslamotors/fleet-telemetry/protos"
)

// One scenario step: a V record (field -> typed value), an alerts record or an errors record.
type step struct {
	Note    string                     `json:"note"`
	V       map[string]json.RawMessage `json:"v"`
	Alerts  []alert                    `json:"alerts"`
	Errors  []vehicleError             `json:"errors"`
	SleepMs int                        `json:"sleep_ms"`
}

type alert struct {
	Name      string   `json:"name"`
	Audiences []string `json:"audiences"`
	Ended     bool     `json:"ended"`
}

type vehicleError struct {
	Name string            `json:"name"`
	Body string            `json:"body"`
	Tags map[string]string `json:"tags"`
}

func main() {
	server := flag.String("server", "fleet-telemetry:443", "host:port of the fleet-telemetry server")
	vin := flag.String("vin", "", "VIN (must match the client certificate CN)")
	cert := flag.String("cert", "car-cert.pem", "client certificate")
	key := flag.String("key", "car-key.pem", "client key")
	ca := flag.String("ca", "telemetry-ca.pem", "CA that signed the server certificate")
	scenario := flag.String("scenario", "scenario.json", "scenario file")
	flag.Parse()

	var steps []step
	raw, err := os.ReadFile(*scenario)
	must(err)
	must(json.Unmarshal(raw, &steps))

	pair, err := tls.LoadX509KeyPair(*cert, *key)
	must(err)
	roots := x509.NewCertPool()
	caPem, err := os.ReadFile(*ca)
	must(err)
	if !roots.AppendCertsFromPEM(caPem) {
		log.Fatalf("no certificates in %s", *ca)
	}
	dialer := websocket.Dialer{
		HandshakeTimeout: 20 * time.Second,
		TLSClientConfig:  &tls.Config{Certificates: []tls.Certificate{pair}, RootCAs: roots},
	}
	headers := http.Header{}
	headers.Add("Version", "2026.32.1")
	u := url.URL{Scheme: "wss", Host: *server, Path: "/"}

	var conn *websocket.Conn
	for i := 0; ; i++ {
		conn, _, err = dialer.Dial(u.String(), headers)
		if err == nil {
			break
		}
		if i == 30 {
			log.Fatalf("connect %s: %v", u.String(), err)
		}
		time.Sleep(time.Second)
	}
	defer conn.Close()
	log.Printf("connected to %s as %s", u.String(), *vin)

	for i, s := range steps {
		if len(s.V) > 0 {
			payload, err := buildV(s.V)
			must(err)
			send(conn, *vin, "V", payload, i)
		}
		if len(s.Alerts) > 0 {
			send(conn, *vin, "alerts", buildAlerts(*vin, s.Alerts), i)
		}
		if len(s.Errors) > 0 {
			send(conn, *vin, "errors", buildErrors(*vin, s.Errors), i)
		}
		log.Printf("step %d sent: %s", i, s.Note)
		if s.SleepMs > 0 {
			time.Sleep(time.Duration(s.SleepMs) * time.Millisecond)
		} else {
			time.Sleep(150 * time.Millisecond)
		}
	}
	// Leave time for the last records to be dispatched before the socket closes.
	time.Sleep(time.Second)
	_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
	log.Printf("done: %d steps", len(steps))
}

func send(conn *websocket.Conn, vin, topic string, payload []byte, i int) {
	senderID := "vehicle_device." + vin
	msgID := fmt.Sprintf("e2e-%d-%s", i, topic)
	msg := tesla.FlatbuffersStreamToBytes([]byte(senderID), []byte(topic), []byte(msgID), payload, 1,
		[]byte(msgID), []byte("vehicle_device"), []byte(vin), uint64(time.Now().UnixMilli()))
	must(conn.WriteMessage(websocket.BinaryMessage, msg))
	// The server answers each record with an ack (or an error) on the same socket.
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, ack, err := conn.ReadMessage()
	if err != nil {
		log.Fatalf("no answer for step %d (%s): %v", i, topic, err)
	}
	m, err := messages.StreamAckMessageFromBytes(ack)
	if err != nil {
		log.Fatalf("server did not ack step %d (%s): %v", i, topic, err)
	}
	if string(m.TXID) != msgID || string(m.MessageTopic) != topic {
		log.Fatalf("ack mismatch for step %d: txid %q topic %q", i, m.TXID, m.MessageTopic)
	}
}

func buildV(fields map[string]json.RawMessage) ([]byte, error) {
	var data []*protos.Datum
	for name, raw := range fields {
		key, ok := protos.Field_value[name]
		if !ok {
			return nil, fmt.Errorf("unknown field %s", name)
		}
		v, err := value(raw)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", name, err)
		}
		data = append(data, &protos.Datum{Key: protos.Field(key), Value: v})
	}
	return proto.Marshal(&protos.Payload{Data: data, CreatedAt: timestamppb.Now()})
}

// value turns {"<kind>": x} into a protos.Value. Kinds are the Value oneof members the scenario uses.
func value(raw json.RawMessage) (*protos.Value, error) {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil || len(m) != 1 {
		return nil, fmt.Errorf("value must be an object with one kind, got %s", raw)
	}
	for kind, x := range m {
		var s string
		var f float64
		var b bool
		switch kind {
		case "string":
			must(json.Unmarshal(x, &s))
			return &protos.Value{Value: &protos.Value_StringValue{StringValue: s}}, nil
		case "double":
			must(json.Unmarshal(x, &f))
			return &protos.Value{Value: &protos.Value_DoubleValue{DoubleValue: f}}, nil
		case "float":
			must(json.Unmarshal(x, &f))
			return &protos.Value{Value: &protos.Value_FloatValue{FloatValue: float32(f)}}, nil
		case "int":
			must(json.Unmarshal(x, &f))
			return &protos.Value{Value: &protos.Value_IntValue{IntValue: int32(f)}}, nil
		case "long":
			must(json.Unmarshal(x, &f))
			return &protos.Value{Value: &protos.Value_LongValue{LongValue: int64(f)}}, nil
		case "bool":
			must(json.Unmarshal(x, &b))
			return &protos.Value{Value: &protos.Value_BooleanValue{BooleanValue: b}}, nil
		case "invalid":
			return &protos.Value{Value: &protos.Value_Invalid{Invalid: true}}, nil
		case "location":
			var ll [2]float64
			must(json.Unmarshal(x, &ll))
			return &protos.Value{Value: &protos.Value_LocationValue{LocationValue: &protos.LocationValue{Latitude: ll[0], Longitude: ll[1]}}}, nil
		case "doors":
			d := &protos.Doors{}
			must(protojson.Unmarshal(x, d))
			return &protos.Value{Value: &protos.Value_DoorValue{DoorValue: d}}, nil
		case "tires":
			t := &protos.TireLocation{}
			must(protojson.Unmarshal(x, t))
			return &protos.Value{Value: &protos.Value_TireLocationValue{TireLocationValue: t}}, nil
		}
		must(json.Unmarshal(x, &s))
		switch kind {
		case "shift":
			return &protos.Value{Value: &protos.Value_ShiftStateValue{ShiftStateValue: protos.ShiftState(enum(protos.ShiftState_value, s))}}, nil
		case "sentry":
			return &protos.Value{Value: &protos.Value_SentryModeStateValue{SentryModeStateValue: protos.SentryModeState(enum(protos.SentryModeState_value, s))}}, nil
		case "charge_state":
			return &protos.Value{Value: &protos.Value_DetailedChargeStateValue{DetailedChargeStateValue: protos.DetailedChargeStateValue(enum(protos.DetailedChargeStateValue_value, s))}}, nil
		case "window":
			return &protos.Value{Value: &protos.Value_WindowStateValue{WindowStateValue: protos.WindowState(enum(protos.WindowState_value, s))}}, nil
		case "hvac":
			return &protos.Value{Value: &protos.Value_HvacPowerValue{HvacPowerValue: protos.HvacPowerState(enum(protos.HvacPowerState_value, s))}}, nil
		case "fast_charger":
			return &protos.Value{Value: &protos.Value_FastChargerValue{FastChargerValue: protos.FastCharger(enum(protos.FastCharger_value, s))}}, nil
		}
		return nil, fmt.Errorf("unknown kind %s", kind)
	}
	return nil, nil
}

func enum(values map[string]int32, name string) int32 {
	v, ok := values[name]
	if !ok {
		log.Fatalf("unknown enum value %s", name)
	}
	return v
}

func buildAlerts(vin string, in []alert) []byte {
	now := timestamppb.Now()
	out := &protos.VehicleAlerts{Vin: vin, CreatedAt: now}
	for _, a := range in {
		va := &protos.VehicleAlert{Name: a.Name, StartedAt: timestamppb.New(time.Now().Add(-time.Minute))}
		if a.Ended {
			va.EndedAt = now
		}
		for _, aud := range a.Audiences {
			va.Audiences = append(va.Audiences, protos.Audience(enum(protos.Audience_value, aud)))
		}
		out.Alerts = append(out.Alerts, va)
	}
	b, err := proto.Marshal(out)
	must(err)
	return b
}

func buildErrors(vin string, in []vehicleError) []byte {
	out := &protos.VehicleErrors{Vin: vin, CreatedAt: timestamppb.Now()}
	for _, e := range in {
		out.Errors = append(out.Errors, &protos.VehicleError{Name: e.Name, Body: e.Body, Tags: e.Tags, CreatedAt: timestamppb.Now()})
	}
	b, err := proto.Marshal(out)
	must(err)
	return b
}

func must(err error) {
	if err != nil {
		log.Fatal(err)
	}
}

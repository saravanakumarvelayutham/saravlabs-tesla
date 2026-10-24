FROM golang:1.27 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY main.go ./
RUN CGO_ENABLED=0 go build -o /fake-car .

FROM scratch
COPY --from=build /fake-car /fake-car
ENTRYPOINT ["/fake-car"]

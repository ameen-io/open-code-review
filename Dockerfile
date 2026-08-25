FROM golang:1.25.5-alpine AS build
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/ocr ./cmd/opencodereview

FROM alpine:3.20
RUN apk add --no-cache ca-certificates git
COPY --from=build /out/ocr /usr/local/bin/ocr
ENTRYPOINT ["ocr"]

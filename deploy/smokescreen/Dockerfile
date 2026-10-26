# Smokescreen egress proxy (docs/02 3.4 layer S2): the only route from the API and
# workers to the internet. Pinned release, checksum-verified, non-root, distroless.
FROM alpine:3.22 AS fetch
ARG VERSION=v0.1.0
ARG TARGETARCH=amd64
# From the release's SHA256SUMS (https://github.com/stripe/smokescreen/releases).
ARG SHA256_amd64=4e1e447449e3cc653dae956208588722b5c8fe8ce894f633adc756a851d1ec46
ARG SHA256_arm64=f15ddd0dc2b2cbc6d7318f441928939eb9bedfab2a1881508af3096a1e24b7c9
RUN apk add --no-cache curl \
 && f="smokescreen_${VERSION}_linux_${TARGETARCH}.tar.gz" \
 && curl -fsSLo "/tmp/$f" "https://github.com/stripe/smokescreen/releases/download/${VERSION}/$f" \
 && eval "want=\$SHA256_${TARGETARCH}" \
 && echo "$want  /tmp/$f" | sha256sum -c - \
 && mkdir /out && tar -xzf "/tmp/$f" -C /out \
 && bin="$(find /out -type f -name smokescreen | head -1)" \
 && test -n "$bin" && install -m 0555 "$bin" /smokescreen

FROM gcr.io/distroless/static:nonroot
COPY --from=fetch /smokescreen /smokescreen
COPY config.yaml acl.yaml /etc/smokescreen/
USER 65532:65532
EXPOSE 4750
ENTRYPOINT ["/smokescreen", "--config-file", "/etc/smokescreen/config.yaml"]

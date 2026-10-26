#!/bin/sh
# Prints fresh random secrets for deploy/.env. Run once; keep the output private.
set -eu
r() { od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }
echo "POSTGRES_PASSWORD=$(r)"
echo "SIGNING_SECRET=$(r)"
echo "IP_HASH_KEY_SEED=$(r)"

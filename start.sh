#!/bin/sh
set -eu
cd -- "$(dirname -- "$0")"
exec node bin/cli.js serve --open

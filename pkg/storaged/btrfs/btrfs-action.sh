#! /bin/bash

set -eux

dev=$1; shift

tmpmp=""

maybe_unmount () {
    if [ -n "$tmpmp" ]; then
        umount "$tmpmp"
        rmdir "$tmpmp"
    fi
}

trap maybe_unmount EXIT INT QUIT

if [ "$dev" != "-" ]; then
    # mount temporarily
    tmpmp=$(mktemp -d)
    mount "$dev" "$tmpmp"
    ( cd "$tmpmp"; btrfs "$@" )
else
    btrfs "$@"
fi

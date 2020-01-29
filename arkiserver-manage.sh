#!/bin/sh 

start() {
  exec /home/ubuntu/www/arki-server/target/release/arki-server /home/ubuntu/www/arki-server/static jq-rs@mles.io mles.io
}

stop() {
  exec killall arki-server  
}

case $1 in
  start|stop) "$1" ;;
esac

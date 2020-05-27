#!/bin/sh 

start() {
  exec /home/ubuntu/www/arki-server/target/release/arki-server /home/ubuntu/www/arki-server/static jq-rs@mles.io mles.io 127.0.0.1:8077
}

stop() {
  exec killall arki-server  
}

case $1 in
  start|stop) "$1" ;;
esac

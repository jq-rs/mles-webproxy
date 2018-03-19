#!/bin/sh 

start() {
  exec /home/ubuntu/www/arki-server/target/release/arki-server 
}

stop() {
  exec killall arki-server  
}

case $1 in
  start|stop) "$1" ;;
esac

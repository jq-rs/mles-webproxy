#!/bin/sh 

start() {
  exec sudo /home/ubuntu/www/arki-server/target/release/arki-server 
}

stop() {
  exec sudo killall arki-server  
}

case $1 in
  start|stop) "$1" ;;
esac

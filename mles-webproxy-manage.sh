#!/bin/sh 

start() {
  exec /home/ubuntu/www/mles-webproxy/target/release/mles-webproxy --domains mles.io --domains www.mles.io --cache . --wwwroot /home/ubuntu/www/mles-webproxy/static --limit 3000
}

stop() {
  exec killall mles-webproxy
}

case $1 in
  start|stop) "$1" ;;
esac

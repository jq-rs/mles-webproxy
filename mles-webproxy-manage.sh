#!/bin/sh 

start() {
  #exec /home/ubuntu/www/mles-webproxy/target/release/mles-webproxy /home/ubuntu/www/mles-webproxy/static jq-rs@mles.io mles.io 127.0.0.1:8077
  exec /home/ubuntu/www/mles-webproxy/target/debug/mles-webproxy --domains mles.io --domains www.mles.io --cache . --wwwroot /home/ubuntu/www/mles-webproxy/static --limit 3000
}

stop() {
  exec killall mles-webproxy
}

case $1 in
  start|stop) "$1" ;;
esac

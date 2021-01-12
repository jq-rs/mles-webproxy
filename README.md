# mles-webproxy

`mles-webproxy` is an Mles WebSocket proxy service for [Mles](https://github.com/jq-rs/mles-rs) WebSocket protocols and a static WWW-server based on Warp.

Mles WebProxy receives traffic over TLS. In case of Mles WebSocket protocol, the connection is upgraded and messages forwarded transformed to AES towards configured Mles server (and vice versa).

Please do end-to-end encrypt the data you send anyway. For more details, please check the Mles specifications.

## Example how to create your own personal proxy server

 1. [Install](https://www.rust-lang.org/tools/install) Rust and Cargo package manager to your preferred server
 2. Install `mles-webproxy`: `RUSTFLAGS="-C target-feature=+aes,+ssse3" cargo install mles-webproxy`
 3. Open port 80 and 443 of your firewall for Mles WebSocket protocol and Let's Encrypt certificates
 4. Startup `mles-webproxy` Mles WebSocket proxy in your local server. *Notice: this will try to fetch certificates from Let's Encrypt by default*:  `export MLES_KEY=<secret-server-key-string-here>; mles-webproxy <www-root> <email-for-tls> <domain-for-tls> <mles-srv-addr x.x.x.x:p>`
     - default ports 80 and 443 need root privileges
 5. Connect to port 443 of your server with a browser or your Mles WebSocket application
  
 Enjoy talking over Mles WebSocket proxy!
 
 ## Available public proxy servers
 
   * https://mles.io:443
   * \<add your public server here\>
 

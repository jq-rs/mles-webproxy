# MlesTalk WebWorker

MlesTalk WebWorker is an open source Mles (Modern Lightweight channEl Service) WebSocket client layer protocol implementation written in JavaScript. MlesTalk WebWorker can be used independently by any application over its messaging application interface. It is used as part of [MlesTalk](https://mles.io/app.html) Android application.

Messages using MlesTalk WebWorker are sent on Transport Layer Security (TLS) [1] protected connection by default which should be secure.

Message data sent is obfuscated end-to-end using symmetrical Blowfish (56-bit, weak key) [2] with CTS [3] + AONT [4] and Blake2 [5] HMAC. While not plain text, please do note that this obfuscation does not protect from serious message opening efforts.

If the Mles Websocket session is connected to [arki-server](https://github.com/jq-rs/arki-server) proxy, it will forward the traffic to Mles server transforming it to AES and vice versa.

Please see https://mles.io for details about Mles protocol.

## MlesTalk WebWorker Messaging API

### Init message
```
/**
 * Initialize Mles WebSocket connection
 *
 * @param  init {String}              IN: command parameter "init"
 * @param  data {String}              IN: data, null for "init"
 * @param  addr {String}              IN: TCP/IP address to connect to
 * @param  port {String}              IN: TCP/IP port to connect to
 * @param  uid {String}               IN: Mles User Id
 * @param  channel {String}           IN: Mles Channel
 * @param  key {String}               IN: Encryption key
 * @param  isEncryptedChannel {bool}  IN: true, if the channel is already in encrypted form
 */
 webWorker.postMessage[("init", data, addr, port, uid, channel, key, isEncryptedChannel)]
```
### Init/Reconnect message receive
```
/**
 * Mles WebSocket connection init receive after successful WebSocket initialization
 *
 * @param  init {String}              OUT: command parameter of receive "init"
 * @param  uid {String}               OUT: Original Mles User Id
 * @param  channel {String}           OUT: Original Mles Channel
 * @param  myuid {String}             OUT: Encrypted Mles User Id for reference
 * @param  mychannel {String}         OUT: Encrypted Mles Channel for reference
 */
 webWorker.onmessage = e.data["init", uid, channel, myuid, mychannel]
```
### Reconnect message
```
/**
 * Reconnect Mles WebSocket connection after close
 *
 * @param  reconnect {String}         IN: command parameter "reconnect"
 * @param  data {String}              IN: data, null for "reconnect"
 * @param  uid {String}               IN: Mles User Id
 * @param  channel {String}           IN: Mles Channel
 */
 webWorker.postMessage[("reconnect", data, uid, channel)]
 ```
### Send message
```
/**
 * Send message over Mles WebSocket connection
 *
 * @param  send {String}              IN: command parameter "send"
 * @param  data {String}              IN: data to be sent
 * @param  uid {String}               IN: Mles User Id
 * @param  channel {String}           IN: Mles Channel
 * @param  isEncryptedChannel {bool}  IN: true, if the channel is already in encrypted form
 * @param  randArray {Uint32Array}    IN: random array filled with input of length 8 x Uint32
 * @param  isFull {bool}              IN: true, if a full message
 * @param  isImage {bool}             IN: true, if an image
 * @param  isMultipart {bool}         IN: true, if multipart send
 * @param  isFirst {bool}             IN: true, if first of multipart send
 * @param  isLast {bool}              IN: true, if last of multipart send
 * @param  valueOfDate {Date}         IN: send time as Date
 */
 webWorker.postMessage[("send", data, uid, channel,  isEncryptedChannel, randarr, isFull, isImage, isMultipart, isFirst, isLast, valueOfDate)]
 ```
### Send message receive
```
/**
 * Mles WebSocket send receive after send
 *
 * @param  send {String}              OUT: command parameter of receive "send"
 * @param  uid {String}               OUT: Original Mles User Id
 * @param  channel {String}           OUT: Original Mles Channel
 * @param  isMultipart {boo           OUT: true, if send was multipart
 */
 webWorker.onmessage = e.data["send", uid, channel,  isMultipart]
``` 
### Data message receive
```
/**
 * Mles WebSocket RX data receive
 *
 * @param  data {String}               OUT: command parameter of receive "data"
 * @param  uid {String}                OUT: Original Mles User Id
 * @param  channel {String}            OUT: Original Mles Channel
 * @param  msgTimestamp {Date.valueOf} OUT: timestamp of the message in X format
 * @param  message {String}            OUT: received message
 * @param  isFull {bool}               OUT: true, if a full message
 * @param  isImage {bool}              OUT: true, if an image
 * @param  isMultipart {bool}          OUT: true, if multipart
 * @param  isFirst {bool}              OUT: true, if first of multipart
 * @param  isLast {bool}               OUT: true, if last of multipart
 */
 webWorker.onmessage = e.data["data", uid, channel, msgTimestamp, message, isFull, isImage, isMultipart, isFirst, isLast]
```
### Close message
```
/**
 * Close message over Mles WebSocket connection
 *
 * @param  close {String}             IN: command parameter "close"
 * @param  data {String}              IN: data, null for close
 * @param  uid {String}               IN: Mles User Id
 * @param  channel {String}           IN: Mles Channel
 */
 webWorker.postMessage[("close", data, uid, channel)]
 ```
### Close message receive
```
/**
 * Mles WebSocket connection close receive after WebSocket closing
 *
 * @param  close {String}             OUT: command parameter of receive "close"
 * @param  uid {String}               OUT: Original Mles User Id
 * @param  channel {String}           OUT: Original Mles Channel
 * @param  myuid {String}             OUT: Encrypted Mles User Id for reference
 * @param  mychannel {String}         OUT: Encrypted Mles Channel for reference
 */
 webWorker.onmessage = e.data["close", uid, channel, myuid, mychannel]
```

## References

  1. The Transport Layer Security (TLS) Protocol Version 1.3, IETF RFC8446
  2. B. Schneier, 1994. Description of a New Variable-Length Key, 64-Bit Block Cipher (Blowfish).
  3. Rogaway, Wooding & Zhang, 2012. The Security of Ciphertext Stealing.
  4. Rivest, 1997. All-or-nothing transform.
  5. Aumasson, Neves, Wilcox-O’Hearn & Winnerlein, 2013. BLAKE2: simpler, smaller, fast as MD5.

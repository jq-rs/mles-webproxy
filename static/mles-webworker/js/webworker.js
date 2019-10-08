/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) 2019 MlesTalk WebWorker developers
 */

importScripts('cbor.js', 'blake2s.js', 'blowfish.js');

var webSocket;
var myaddr;
var myport;
var myuid;
var mychannel;
var ecbkey;
const SCATTERSIZE = 15;
const ISFULL  = 0x8000
const ISIMAGE = 0x4000;
const ISMULTI = 0x4000;
const ISFIRST = 0x2000;
const ISLAST  = 0x1000;
const BEGIN = new Date(Date.UTC(2018, 0, 1, 0, 0, 0));

function scatterTime(rvalU32, valU32, timeU15)
{
	//check first which bits to use
	var numofones = 0;
	var isOnes = true;
	for (var i = 31; i >= 0; i--) {
		var bit = new Uint32Array(1);
		bit[0] = (rvalU32 & (1 << i)) >> i;
		if(bit[0] > 0) {
			numofones++;
		}
	}
	var timeslot = SCATTERSIZE;
	if(numofones <= timeslot)
		isOnes = false;	
	for (var i = 31; i >= 0; i--) {
		bit[0] = (rvalU32 & (1 << i)) >> i;
		if((isOnes && bit[0] > 0) || (false == isOnes && 0 == bit[0])) {
			var tbit = new Uint32Array(1);
			//apply setting to next item
			tbit[0] = (timeU15 & (1 << timeslot)) >> timeslot;
			if(tbit[0] > 0) {
				valU32 |= (1 << i);
			}
			else {
				valU32 &= ~(1 << i);				
			}
			timeslot--;
			if(timeslot < 0)
				break;
		}
	}
	return valU32;
}

function unscatterTime(rvalU32, svalU32)
{
	//check first which bits to use
	var numofones = 0;
	var timeU15 = new Uint32Array(1);
	var isOnes = true;
	for (var i = 31; i >= 0; i--) {
		var bit = new Uint32Array(1);
		bit[0] = (rvalU32 & (1 << i)) >> i;
		if(bit[0] > 0) {
			numofones++;
		}
	}
	var timeslot = SCATTERSIZE;
	if(numofones <= timeslot)
		isOnes = false;	
	for (var i = 31; i >= 0; i--) {
		var bit = new Uint32Array(1);
		bit[0] = (rvalU32 & (1 << i)) >> i;
		if((isOnes && bit[0] > 0) || (false == isOnes && 0 == bit[0])) {
			var sbit = new Uint32Array(1);
			sbit[0] = (svalU32 & (1 << i)) >> i;
			if(sbit[0] > 0)
				timeU15[0] |= (1 << timeslot);
			timeslot--;
			if(timeslot < 0)
				break;
		}
	}
	return timeU15[0];
}

function createTimestamp(weekstamp) {
	var begin = BEGIN;
	var this_week = new Date(begin.valueOf() + weekstamp*1000*60*60*24*7);
	var timestamp = parseInt((Date.now() - this_week)/1000/60);
	return timestamp;
}

function createWeekstamp() {
	var begin = BEGIN;
	var now = new Date(Date.now());
	var weekstamp = parseInt((now - begin)/1000/60/60/24/7);
	return weekstamp;
}

function readTimestamp(timestamp, weekstamp) {
	var begin = BEGIN;
	var weeks = new Date(begin.valueOf() + weekstamp*1000*60*60*24*7);
	var extension = timestamp * 1000 * 60;	
	var time = new Date(weeks.valueOf() + extension);
	return time;
}

function isEqualHmacs(hmac, rhmac) {
	for(var i = 0; i < hmac.byteLength; i++) {
		if(hmac[i] != rhmac[i]) {
			return false;
		}
	}
	return true;
}

function iv2u8arr(iv) {
	var ivu8 = new Uint8Array(8);
	ivu8[0] = iv[0] >> 24;
	ivu8[1] = iv[0] >> 16 & 0xff;
	ivu8[2] = iv[0] >> 8 & 0xff;
	ivu8[3] = iv[0] & 0xff;
	ivu8[4] = iv[1] >> 24;
	ivu8[5] = iv[1] >> 16 & 0xff;
	ivu8[6] = iv[1] >> 8 & 0xff;
	ivu8[7] = iv[1] & 0xff;
	return ivu8;
}

function u8arr2iv(ivm) {
	var iv = new Uint32Array(2);
	iv[0] = ivm[0] << 24 | ivm[1] << 16 | ivm[2] << 8 | ivm[3];
	iv[1] = ivm[4] << 24 | ivm[5] << 16 | ivm[6] << 8 | ivm[7];
	return iv;
}

function load32(a, i) {
	return (a[i + 0] & 0xff) | ((a[i + 1] & 0xff) << 8) |
		((a[i + 2] & 0xff) << 16) | ((a[i + 3] & 0xff) << 24);
}

function store32(a, i, val) {
	a[i+0] = val & 0xff;
	a[i+1] = (val & 0xff00) >> 8;
	a[i+2] = (val & 0xff0000) >> 16;
	a[i+3] = (val & 0xff000000) >> 24;
	return a;
} 

function StringToUint8(str) {
	var arr = new Uint8Array(str.length);
	var len = str.length;
	for (var i=0; i < len; i++) {
		arr[i] = str.charCodeAt(i);
	}
	return arr;
}

function Uint8ToString(arr) {
	var str = new String('');
	for(var i=0; i < arr.length; i++) {
		str += String.fromCharCode(arr[i]);
	};
	return str;
}

function open_socket(myport, myaddr, uid, channel) {
	if (webSocket !== undefined && webSocket.readyState == WebSocket.OPEN) {
		return;
	}

	webSocket = new WebSocket("ws://" + myaddr + ":" + myport
		+ "?myname=" + uid
		+ "&mychannel=" + channel, "mles-websocket");
	webSocket.binaryType = "arraybuffer";
	webSocket.onopen = function(event) {
		var uid = bfEcb.trimZeros(bfEcb.decrypt(atob(myuid)));
		var channel = bfEcb.trimZeros(bfEcb.decrypt(atob(mychannel)));	
		postMessage(["init", uid, channel, myuid, mychannel]);
	};

	webSocket.onmessage = function(event) {
		if(event.data) {
			var msg;
			try {
				msg = CBOR.decode(event.data);
			} catch(err) {
				return;
			}
			//sanity
			if(msg.message.byteLength <= 8 || msg.message.byteLength > 0xffffff)
				return;

			var ivm = msg.message.slice(0,8);
			var arr = msg.message.slice(8,msg.message.byteLength-8);
			var hmac = msg.message.slice(msg.message.byteLength-8, msg.message.byteLength)
			var message = Uint8ToString(arr);

			//verify first hmac
			var hmacarr = new Uint8Array(ivm.byteLength + arr.byteLength);
			hmacarr.set(ivm, 0);
			hmacarr.set(arr, ivm.byteLength);
			var blakehmac = new BLAKE2s(8, ecbkey);
			blakehmac.update(hmacarr);
			var rhmac = blakehmac.digest();
			if(false == isEqualHmacs(hmac, rhmac)) {
				return;
			}

			var iv = u8arr2iv(ivm);

			var uid = bfEcb.trimZeros(bfEcb.decrypt(atob(msg.uid)));
			var channel = bfEcb.trimZeros(bfEcb.decrypt(atob(msg.channel)));
			var decrypted = bfCbc.decrypt(message, iv);

			if(decrypted.length < 16)
				return;

			var timestring = decrypted.slice(0,8);
			var rarray = bfCbc.split64by32(timestring);
			var timeU15 = unscatterTime(rarray[0], rarray[1]);
			var weekstring = decrypted.slice(8,16);
			var warray = bfCbc.split64by32(weekstring);
			var weekU15 = unscatterTime(warray[0], warray[1]);
			var msgDate = readTimestamp(timeU15 & ~(ISFULL|ISIMAGE), weekU15 & ~(ISMULTI|ISFIRST|ISLAST));
			var message = decrypted.slice(16, decrypted.byteLength);

			var isFull = false;
			var isImage = false;
			var isMultipart = false;
			var isFirst = false;
			var isLast = false;
			if(timeU15 & ISFULL) {
				isFull = true;
			}
			if(timeU15 & ISIMAGE)
				isImage = true;
			if(weekU15 & ISMULTI)
				isMultipart = true;
			if(weekU15 & ISFIRST)
				isFirst = true;
			if(weekU15 & ISLAST)
				isLast = true;

			postMessage(["data", uid, channel, msgDate.valueOf(), message, isFull, isImage, isMultipart, isFirst, isLast]);
		}
	};

	webSocket.onclose = function(event) {
		webSocket.close();
		var uid = bfEcb.trimZeros(bfEcb.decrypt(atob(myuid)));
		var channel = bfEcb.trimZeros(bfEcb.decrypt(atob(mychannel)));	
		postMessage(["close", uid, channel, myuid, mychannel]);
	};
}

onmessage = function(e) {
	var cmd = e.data[0];
	var data = e.data[1];

	switch(cmd) {
		case "init":
			myaddr = e.data[2];
			myport = e.data[3];
			var uid = e.data[4];
			var channel = e.data[5];
			var fullkey = StringToUint8(e.data[6]);
			var isEncryptedChannel = e.data[7];

			var round = new BLAKE2s();
			round.update(fullkey);

			var blakecb = new BLAKE2s(7); //56-bits max key len
			blakecb.update(round.digest());
			var ecbkey = blakecb.digest();

			var round = new BLAKE2s();
			round.update(fullkey);
			round.update(fullkey);
			var blakeaontecb = new BLAKE2s(8); //aont key len
			blakeaontecb.update(round.digest());
			var ecbaontkey = blakeaontecb.digest();

			var blakecbc = new BLAKE2s(7); //56-bits max key len
			blakecbc.update(fullkey);
			var cbckey = blakecbc.digest();

			var round = new BLAKE2s();
			round.update(fullkey);
			round.update(fullkey);			
			round.update(fullkey);

			//drop unused
			fullkey = "";

			var blakeaontcbc = new BLAKE2s(8); //aont key len
			blakeaontcbc.update(round.digest());
			var cbcaontkey = blakeaontcbc.digest();

			bfEcb = new Blowfish(ecbkey, ecbaontkey);
			bfCbc = new Blowfish(cbckey, cbcaontkey, "cbc");
			myuid = btoa(bfEcb.encrypt(uid));

			var bfchannel;
			if(!isEncryptedChannel) {
				bfchannel = bfEcb.encrypt(channel);
				mychannel = btoa(bfchannel);
			}
			else {
				mychannel = channel;
			}
			open_socket(myport, myaddr, myuid, mychannel);
			break;
		case "reconnect":
			var uid = e.data[2];
			var channel = e.data[3];
			var isEncryptedChannel = e.data[4];

			uid = btoa(bfEcb.encrypt(uid));
			if(!isEncryptedChannel) {
				bfchannel = bfEcb.encrypt(channel);
				channel = btoa(bfchannel);
			}
			// verify that we have already opened the channel earlier
			if(myuid === uid && mychannel === channel) {
				open_socket(myport, myaddr, myuid, mychannel);
			}
			break;
		case "send":
			var uid = e.data[2];
			var channel = e.data[3];
			var isEncryptedChannel = e.data[4];
			var randarr = e.data[5];

			//sanity
			if(randarr.length != 6) {
				break;
			}

			var isFull = e.data[6];
			var isImage = e.data[7];
			var isMultipart = e.data[8];
			var isFirst = e.data[9];
			var isLast = e.data[10];
			var iv = randarr.slice(0,2);
			var rarray = randarr.slice(2);

			if(isEncryptedChannel) {
				channel = bfEcb.trimZeros(bfEcb.decrypt(atob(channel)));
			}

			var weekstamp = createWeekstamp();
			var timestamp = createTimestamp(weekstamp);
			if(isFull) {
				timestamp |= ISFULL;
			}
			if(isImage) {
				timestamp |= ISIMAGE;
			}
			if(isMultipart) {
				weekstamp |= ISMULTI;
				if(isFirst) {
					weekstamp |= ISFIRST;	
				}
				if(isLast) {
					weekstamp |= ISLAST;	
				}
			}
			var sval = scatterTime(rarray[0], rarray[1], timestamp);
			rarray[1] = sval;
			sval = scatterTime(rarray[2], rarray[3], weekstamp);
			rarray[3] = sval;

			var newmessage = bfCbc.num2block32(rarray[0]) + bfCbc.num2block32(rarray[1]) + 
				bfCbc.num2block32(rarray[2]) + bfCbc.num2block32(rarray[3]) +  data;
			var encrypted = bfCbc.encrypt(newmessage, iv);
			var ivarr = iv2u8arr(iv);
			var arr = StringToUint8(encrypted);

			// calculate 8 byte hmac
			var hmacarr = new Uint8Array(ivarr.byteLength + arr.byteLength);
			hmacarr.set(ivarr, 0);
			hmacarr.set(arr, ivarr.byteLength);

			var blakehmac = new BLAKE2s(8, ecbkey);
			blakehmac.update(hmacarr);
			var hmac = blakehmac.digest();

			var newarr = new Uint8Array(ivarr.byteLength + arr.byteLength + hmac.byteLength);
			newarr.set(ivarr, 0);
			newarr.set(arr, ivarr.byteLength);
			newarr.set(hmac, ivarr.byteLength + arr.byteLength);

			var obj = {
				uid: btoa(bfEcb.encrypt(uid)),
				channel: btoa(bfEcb.encrypt(channel)),
				message: newarr
			};
			var cbor;
			try {
				cbor = CBOR.encode(obj);
			} catch(err) {
				break;
			}
			try {
				webSocket.send(cbor);
			} catch(err) {
				break; 
			}
			postMessage(["send", uid, channel, isMultipart]);
			break;
		case "close":
			var uid = e.data[2];
			var channel = e.data[3];
			var isEncryptedChannel = e.data[4];
			webSocket.close();
			break;
	}
}

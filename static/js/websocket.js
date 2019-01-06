importScripts('cbor.js', 'blake2s.js', 'blowfish.js');

var webSocket;
var	myaddr;
var	myport;
var	myuid;
var	mychannel;
var ecbkey;

function scatterTime(rvalU32, valU32, timeU14)
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
	var timeslot = 14;
	if(numofones <= timeslot)
		isOnes = false;	
	for (var i = 31; i >= 0; i--) {
		bit[0] = (rvalU32 & (1 << i)) >> i;
		if((isOnes && bit[0] > 0) || (false == isOnes && 0 == bit[0])) {
			var tbit = new Uint32Array(1);
			//apply setting to next item
			tbit[0] = (timeU14 & (1 << timeslot)) >> timeslot;
			if(tbit[0] > 0) {
				valU32 = valU32 | (1 << i);
			}
			else {
				valU32 = valU32 & ~(1 << i);				
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
	var timeU14 = new Uint32Array(1);
	var isOnes = true;
	for (var i = 31; i >= 0; i--) {
		var bit = new Uint32Array(1);
		bit[0] = (rvalU32 & (1 << i)) >> i;
		if(bit[0] > 0) {
			numofones++;
		}
	}
	var timeslot = 14;
	if(numofones <= timeslot)
		isOnes = false;	
	for (var i = 31; i >= 0; i--) {
		var bit = new Uint32Array(1);
		bit[0] = (rvalU32 & (1 << i)) >> i;
		if((isOnes && bit[0] > 0) || (false == isOnes && 0 == bit[0])) {
			var sbit = new Uint32Array(1);
			sbit[0] = (svalU32 & (1 << i)) >> i;
			if(sbit[0] > 0)
				timeU14[0] = timeU14[0] | (1 << timeslot);
			timeslot--;
			if(timeslot < 0)
				break;
		}
	}
	return timeU14[0];
}

function createTimestamp(weekstamp) {
	var begin = new Date(Date.UTC(2018, 0, 1, 0, 0, 0));
	var this_week = new Date(begin.valueOf() + weekstamp*1000*60*60*24*7);
	var timestamp = parseInt((Date.now() - this_week)/1000/60);
	return timestamp;
}

function createWeekstamp() {
	var begin = new Date(Date.UTC(2018, 0, 1, 0, 0, 0));
	var now = new Date(Date.now());
	var weekstamp = parseInt((now - begin)/1000/60/60/24/7);
	return weekstamp;
}

function readTimestamp(timestamp, weekstamp) {
	var begin = new Date(Date.UTC(2018, 0, 1, 0, 0, 0));
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

var weekday = new Array(7);
weekday[0] = "Sun";
weekday[1] = "Mon";
weekday[2] = "Tue";
weekday[3] = "Wed";
weekday[4] = "Thu";
weekday[5] = "Fri";
weekday[6] = "Sat";

function stamptime(msgdate) {
	var dd=msgdate.getDate(),
	mm=msgdate.getMonth()+1,
	yyyy=msgdate.getFullYear(),
    h=msgdate.getHours(), 
    m=msgdate.getMinutes(), 
    day=weekday[msgdate.getDay()];
	if(dd<10) dd='0'+dd;
	if(mm<10) mm='0'+mm;
    if(m<10) m='0'+m;
    return "[" + dd + '.' + mm + '.' + yyyy + ' ' + day + ' ' + h + ':' + m + "] ";
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
 
onmessage = function(e) {
    var msg = CBOR.decode(e.data);
	var iv = msg.message.slice(0,8);
	var arr = msg.message.slice(8,msg.message.byteLength-8);
	var hmac = msg.message.slice(msg.message.byteLength-8, msg.message.byteLength)
	var message = Uint8ToString(arr);
	postMessage([msg.uid, msg.channel, iv, message, hmac]);
}

function open_socket(myport, myaddr, uid, channel) {
    if (webSocket !== undefined && webSocket.readyState !== WebSocket.CLOSED) {
        return;
    }
	
	WebSocket.pluginOptions = {
		maxConnectTime: 5000,
		override: false
	};
	
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
			var msg = CBOR.decode(event.data);
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
			
			var timestring = decrypted.slice(0,8);
			var rarray = bfCbc.split64by32(timestring);
			var timeU14 = unscatterTime(rarray[0], rarray[1]);
			var weekstring = decrypted.slice(8,16);
			var warray = bfCbc.split64by32(weekstring);
			var weekU14 = unscatterTime(warray[0], warray[1]);
			var msgDate = readTimestamp(timeU14 & ~0x4000, weekU14 & ~(0x4000|0x2000|0x1000));
			var dateString = stamptime(msgDate);
			var message = decrypted.slice(16, decrypted.byteLength);
			
			var isImage = false;
			var isMultipart = false;
			var isFirst = false;
			var isLast = false;
			if(timeU14 & 0x4000)
				isImage = true;
			if(weekU14 & 0x4000)
				isMultipart = true;
			if(weekU14 & 0x2000)
				isFirst = true;
			if(weekU14 & 0x1000)
				isLast = true;
			
			postMessage(["data", uid, channel, dateString, message, isImage, isMultipart, isFirst, isLast]);
        }
    };

    webSocket.onclose = function(event) {
       webSocket.close();
	   var uid = bfEcb.trimZeros(bfEcb.decrypt(atob(myuid)));
	   var channel = bfEcb.trimZeros(bfEcb.decrypt(atob(mychannel)));	
	   postMessage(["close", null, uid, channel, myuid, mychannel]);
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
			var fullkey = e.data[6];
			var isTokenChannel = e.data[7];
			
			var round = new BLAKE2s();
			round.update(StringToUint8(fullkey));
			var blakecb = new BLAKE2s(7); //56-bits max key len
			blakecb.update(round.digest());
			var ecbkey = blakecb.digest();
			var blakecbc = new BLAKE2s(7); //56-bits max key len
			blakecbc.update(StringToUint8(fullkey));
			var cbckey = blakecbc.digest();
			
			bfEcb = new Blowfish(ecbkey);
			bfCbc = new Blowfish(cbckey, "cbc");
			myuid = btoa(bfEcb.encrypt(uid));
		
			var bfchannel;
			if(!isTokenChannel) {
				bfchannel = bfEcb.encrypt(channel);
				mychannel = btoa(bfchannel);
			}
			else {
				mychannel = channel;
			}
			/* Fallthrough */
		case "reconnect":
			open_socket(myport, myaddr, myuid, mychannel);
			break;
		case "send":
			var uid = e.data[2];
			var channel = e.data[3];
			var isTokenChannel = e.data[4];
			var randarr = e.data[5];
			var isImage = e.data[6];
			var isMultipart = e.data[7];
			var isFirst = e.data[8];
			var isLast = e.data[9];
			var iv = randarr.slice(0,2);
			var rarray = randarr.slice(2);

			if(isTokenChannel) {
				channel = bfEcb.trimZeros(bfEcb.decrypt(atob(channel)));
			}
			
			var weekstamp = createWeekstamp();
			var timestamp = createTimestamp(weekstamp);
			if(isImage) {
				timestamp = timestamp | 0x4000;
			}
			if(isMultipart) {
				weekstamp = weekstamp | 0x4000;
				if(isFirst) {
					weekstamp = weekstamp | 0x2000;	
				}
				if(isLast) {
					weekstamp = weekstamp | 0x1000;	
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
			var cbor = CBOR.encode(obj);
			webSocket.send(cbor);
			postMessage(["send", uid, channel, isMultipart]);
			break;
		case "close":
			webSocket.close();
			break;
	}
}



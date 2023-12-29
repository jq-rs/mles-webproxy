/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) 2019-2020 MlesTalk WebWorker developers
 */


importScripts('cbor.js', 'blake2s.js', 'blowfish.js', 'scrypt-async.js', 'bigint-mod-arith.js', 'lz-string.js');

let gWebSocket = {};
let gMyAddr = {};
let gMyPort = {};
let gMyUid = {};
let gMyChannel = {};
let gChannelKey = {};
let gChanCrypt = {};
let gMsgCrypt = {};
const SCATTERSIZE = 15;
const ISFULL = 0x8000
const ISDATA = 0x4000;
const ISPRESENCE = 0x2000;
const ISPRESENCEACK = 0x1000;
const ISMULTI = 0x800;
const ISFIRST = 0x400;
const ISLAST = 0x200;
const ISBDONE = 0x100;
const ISBDACK = 0x80;
const ALLISSET = 0X7F;
const BEGIN = new Date(Date.UTC(2018, 0, 1, 0, 0, 0));
const HMAC_LEN = 12;
const NONCE_LEN = 32;
const DOMAIN_ENCKEY = StringToUint8("Mles-WebWorkerCompEncryptDom!v1");
const DOMAIN_CHANKEY = StringToUint8("Mles-WebWorkerCompChannelDom!v1");
const DOMAIN_AUTHKEY = StringToUint8("Mles-WebWorkerCompAuthDom!v1");
const RECREATE_TIMER = 1000;

const HDRLEN = 40;

/* Msg type flags */
const MSGISFULL =         0x1;
const MSGISPRESENCE =    (0x1 << 1);
const MSGISDATA =        (0x1 << 2);
const MSGISMULTIPART =   (0x1 << 3);
const MSGISFIRST =       (0x1 << 4);
const MSGISLAST =        (0x1 << 5);
const MSGISPRESENCEACK = (0x1 << 6);
const MSGPRESACKREQ =    (0x1 << 7);
const MSGISBDONE =       (0x1 << 8);
const MSGISBDACK =	 (0x1 << 9);

const SCRYPT_SALTLEN = 32;
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_DKLEN = 32;

const DH_GENERATOR = 2;
const DH_BITS = 512;
let gMyDhKey = {};
let gDhDb = {};
let gBdDb = {};
let gBdAckDb = {};

function scatterU16(rvalU32, valU32, valU16) {
	//check first which bits to use
	let tbit = new Uint32Array(1);
	let bit = new Uint32Array(1);
	let numofones = 0;
	let isOnes = true;
	for (let i = 31; i >= 0; i--) {
		bit[0] = (rvalU32 & (1 << i)) >> i;
		if (bit[0] > 0) {
			numofones++;
		}
	}
	let slot = SCATTERSIZE;
	if (numofones <= slot)
		isOnes = false;
	for (let i = 31; i >= 0; i--) {
		bit[0] = (rvalU32 & (1 << i)) >> i;
		if ((isOnes && bit[0] > 0) || (false == isOnes && 0 == bit[0])) {
			//apply setting to next item
			tbit[0] = (valU16 & (1 << slot)) >> slot;
			if (tbit[0] > 0) {
				valU32 |= (1 << i);
			}
			else {
				valU32 &= ~(1 << i);
			}
			slot--;
			if (slot < 0)
				break;
		}
	}
	return valU32;
}

function unscatterU16(rvalU32, svalU32) {
	//check first which bits to use
	let valU16 = new Uint32Array(1);
	let sbit = new Uint32Array(1);
	let bit = new Uint32Array(1);
	let numofones = 0;
	let isOnes = true;
	for (let i = 31; i >= 0; i--) {
		bit[0] = (rvalU32 & (1 << i)) >> i;
		if (bit[0] > 0) {
			numofones++;
		}
	}
	let slot = SCATTERSIZE;
	if (numofones <= slot)
		isOnes = false;
	for (let i = 31; i >= 0; i--) {
		bit[0] = (rvalU32 & (1 << i)) >> i;
		if ((isOnes && bit[0] > 0) || (false == isOnes && 0 == bit[0])) {
			sbit[0] = (svalU32 & (1 << i)) >> i;
			if (sbit[0] > 0)
				valU16[0] |= (1 << slot);
			slot--;
			if (slot < 0)
				break;
		}
	}
	return valU16[0];
}

function createFlagstamp(valueofdate, weekstamp, timestamp) {
	let begin = BEGIN;
	let this_time = new Date(begin.valueOf() + weekstamp * 1000 * 60 * 60 * 24 * 7 + timestamp * 1000 * 60);
	let flagstamp = parseInt((valueofdate - this_time) / 1000);
	return flagstamp;
}

function createTimestamp(valueofdate, weekstamp) {
	let begin = BEGIN;
	let this_week = new Date(begin.valueOf() + weekstamp * 1000 * 60 * 60 * 24 * 7);
	let timestamp = parseInt((valueofdate - this_week) / 1000 / 60);
	return timestamp;
}

function createWeekstamp(valueofdate) {
	let begin = BEGIN;
	let now = new Date(valueofdate);
	let weekstamp = parseInt((now - begin) / 1000 / 60 / 60 / 24 / 7);
	return weekstamp;
}

function readTimestamp(timestamp, weekstamp, flagstamp) {
	let begin = BEGIN;
	let weeks = new Date(begin.valueOf() + weekstamp * 1000 * 60 * 60 * 24 * 7);
	let extension = timestamp * 1000 * 60 + flagstamp * 1000;
	let time = new Date(weeks.valueOf() + extension);
	return time;
}

function isEqualHmacs(hmac, rhmac) {
	let mac1 = new BLAKE2s(HMAC_LEN);
	let mac2 = new BLAKE2s(HMAC_LEN);

	mac1.update(hmac);
	mac2.update(rhmac);

	let hmac1 = mac1.digest();
	let hmac2 = mac2.digest();

	for (let i = 0; i < hmac1.byteLength; i++) {
		if (hmac1[i] != hmac2[i]) {
			return false;
		}
	}
	return true;
}

function nonce2u8arr(nonce) {
	let nonceu8 = new Uint8Array(NONCE_LEN);
	nonceu8[0] = nonce[0] >> 24;
	nonceu8[1] = nonce[0] >> 16 & 0xff;
	nonceu8[2] = nonce[0] >> 8 & 0xff;
	nonceu8[3] = nonce[0] & 0xff;
	nonceu8[4] = nonce[1] >> 24;
	nonceu8[5] = nonce[1] >> 16 & 0xff;
	nonceu8[6] = nonce[1] >> 8 & 0xff;
	nonceu8[7] = nonce[1] & 0xff;
	nonceu8[8] = nonce[2] >> 24;
	nonceu8[9] = nonce[2] >> 16 & 0xff;
	nonceu8[10] = nonce[2] >> 8 & 0xff;
	nonceu8[11] = nonce[2] & 0xff;
	nonceu8[12] = nonce[3] >> 24;
	nonceu8[13] = nonce[3] >> 16 & 0xff;
	nonceu8[14] = nonce[3] >> 8 & 0xff;
	nonceu8[15] = nonce[3] & 0xff;
	nonceu8[16] = nonce[4] >> 24;
	nonceu8[17] = nonce[4] >> 16 & 0xff;
	nonceu8[18] = nonce[4] >> 8 & 0xff;
	nonceu8[19] = nonce[4] & 0xff;
	nonceu8[20] = nonce[5] >> 24;
	nonceu8[21] = nonce[5] >> 16 & 0xff;
	nonceu8[22] = nonce[5] >> 8 & 0xff;
	nonceu8[23] = nonce[5] & 0xff;
	nonceu8[24] = nonce[6] >> 24;
	nonceu8[25] = nonce[6] >> 16 & 0xff;
	nonceu8[26] = nonce[6] >> 8 & 0xff;
	nonceu8[27] = nonce[6] & 0xff;
	nonceu8[28] = nonce[7] >> 24;
	nonceu8[29] = nonce[7] >> 16 & 0xff;
	nonceu8[30] = nonce[7] >> 8 & 0xff;
	nonceu8[31] = nonce[7] & 0xff;
	return nonceu8;
}

function u8arr2nonce(noncem) {
	let nonce = new Uint32Array(NONCE_LEN/4);
	nonce[0] = noncem[0] << 24 | noncem[1] << 16 | noncem[2] << 8 | noncem[3];
	nonce[1] = noncem[4] << 24 | noncem[5] << 16 | noncem[6] << 8 | noncem[7];
	nonce[2] = noncem[8] << 24 | noncem[9] << 16 | noncem[10] << 8 | noncem[11];
	nonce[3] = noncem[12] << 24 | noncem[13] << 16 | noncem[14] << 8 | noncem[15];
	nonce[4] = noncem[16] << 24 | noncem[17] << 16 | noncem[18] << 8 | noncem[19];
	nonce[5] = noncem[20] << 24 | noncem[21] << 16 | noncem[22] << 8 | noncem[23];
	nonce[6] = noncem[24] << 24 | noncem[25] << 16 | noncem[26] << 8 | noncem[27];
	nonce[7] = noncem[28] << 24 | noncem[29] << 16 | noncem[30] << 8 | noncem[31];
	return nonce;
}

function load32(a, i) {
	return (a[i + 0] & 0xff) | ((a[i + 1] & 0xff) << 8) |
		((a[i + 2] & 0xff) << 16) | ((a[i + 3] & 0xff) << 24);
}

function store32(a, i, val) {
	a[i + 0] = val & 0xff;
	a[i + 1] = (val & 0xff00) >> 8;
	a[i + 2] = (val & 0xff0000) >> 16;
	a[i + 3] = (val & 0xff000000) >> 24;
	return a;
}

function StringToUint8(str) {
	let arr = new Uint8Array(str.length);
	let len = str.length;
	for (let i = 0; i < len; i++) {
		arr[i] = str.charCodeAt(i);
	}
	return arr;
}

function Uint8ToString(arr) {
	let str = new String('');
	for (let i = 0; i < arr.length; i++) {
		str += String.fromCharCode(arr[i]);
	};
	return str;
}

function initBd(channel, myuid) {
	gBdDb[channel] = {};
	gBdAckDb[channel] = {};
	gMyDhKey[channel].secret = BigInt(0);
	gMyDhKey[channel].secretAcked = false;
	gMyDhKey[channel].bdMsgCrypt = null;
	if (gMyDhKey[channel].fsInformed) {
		processOnForwardSecrecyOff(channel);
		gMyDhKey[channel].fsInformed = false;
	}
}

function initDhBd(channel, myuid) {
	gDhDb[channel] = {};
	gBdDb[channel] = {};
	gBdAckDb[channel] = {};
	if (gMyDhKey[channel].public) {
		gDhDb[channel][myuid] = gMyDhKey[channel].public;
	}
	gMyDhKey[channel].secret = BigInt(0);
	gMyDhKey[channel].secretAcked = false;
	gMyDhKey[channel].bdMsgCrypt = null;
	if (gMyDhKey[channel].fsInformed) {
		processOnForwardSecrecyOff(channel);
		gMyDhKey[channel].fsInformed = false;
	}
}

function initPrevDhBd(channel, myuid) {
	gMyDhKey[channel].prevBdChannelKey = null;
	gMyDhKey[channel].prevBdMsgCrypt = null;
}

const BDDEBUG = false;
function processBd(channel, uid, msgtype, timestamp, message) {
	const myuid = gChanCrypt[channel].trimZeros(gChanCrypt[channel].decrypt(atob(gMyUid[channel])));
	if(uid == myuid) {  //received own message, init due to resyncing
		initDhBd(channel, myuid);
	}
	else if (message.length == DH_BITS/8 || message.length == 2 * (DH_BITS/8)) {
		if(BDDEBUG)
			console.log("Got " + uid + " public+bd key, len " + message.length);

		if (message.length == DH_BITS/8 && 0 == (msgtype & MSGISBDONE) && 0 == (msgtype & MSGISBDACK)) {
			if ((msgtype & MSGISPRESENCE) && 0 == (msgtype & MSGISPRESENCEACK)) {
				msgtype |= MSGPRESACKREQ; // inform upper layer about presence ack requirement
				if(BDDEBUG)
					console.log("Request presence ack for " + myuid + "@" + channel);
			}

			if(BDDEBUG)
				console.log("!!! bd invalidated in short message !!!");
			initBd(channel, myuid);
		}

		let pub = buf2bn(StringToUint8(message.substring(0, DH_BITS/8)));
		if (null == gDhDb[channel][uid]) {
			gDhDb[channel][uid] = pub;
		}
		else if (gDhDb[channel][uid] != pub) {
			initBd(channel, myuid);
			if(BDDEBUG)
				console.log("!!! skey invalidated in mismatching dh, init bd !!!");
			gDhDb[channel][uid] = pub;
		}
		else {
			//calculate bd key
			if(!gBdDb[channel])
				gBdDb[channel] = {};
			let prevkey = null;
			let nextkey = null;
			let index = 0;
			let pubcnt = 0;
			let dhdb_sorted = Object.fromEntries(Object.entries(gDhDb[channel]).sort());
			let keys = [];
			for (let userid in dhdb_sorted) {
				if (userid == myuid) {
					index = pubcnt;
				}
				keys.push(gDhDb[channel][userid]);
				pubcnt++;
			}

			const len = keys.length;
			if (index == 0) {
				prevkey = keys[len - 1];
				nextkey = keys[index + 1];
			}
			else if (index == len - 1) {
				prevkey = keys[index - 1];
				nextkey = keys[0];
			}
			else {
				prevkey = keys[index - 1];
				nextkey = keys[index + 1];
			}
			if (prevkey && nextkey) {
				const bd = nextkey * modInv(prevkey, gMyDhKey[channel].prime) % gMyDhKey[channel].prime;
				gMyDhKey[channel].bd = modPow(bd, gMyDhKey[channel].private, gMyDhKey[channel].prime);
				gBdDb[channel][myuid] = gMyDhKey[channel].bd;
			}

			if (message.length == 2 * (DH_BITS/8) || (message.length == DH_BITS/8 && (msgtype & MSGISBDONE))) {
				let bd = BigInt(1);
				let init = false;
				let len = 0;
				if (message.length == 2 * (DH_BITS/8))
					len = 2 * DH_BITS/8;

				if(len)
					bd = buf2bn(StringToUint8(message.substring(DH_BITS/8, len)));

				if (gBdDb[channel][uid] != null && gBdDb[channel][uid] != bd) {
					//start again
					initBd(channel, myuid);
					if(BDDEBUG)
						console.log("!!! skey invalidated in mismatching bd !!!");
					init = true;

				}
				else if (pubcnt > 2 && bd == BigInt(1) || pubcnt == 2 && bd != BigInt(1)) {
					initBd(channel, myuid);
					if(BDDEBUG)
						console.log("!!! skey invalidated in mismatching bd length!!! pubcnt " + pubcnt + " bd " + bd.toString(16));
					if ((msgtype & MSGISPRESENCE) && 0 == (msgtype & MSGISPRESENCEACK)) {
						msgtype |= MSGPRESACKREQ; // inform upper layer about presence ack requirement
						if(BDDEBUG)
							console.log("Request presence ack for " + myuid + "@" + channel);
					}
					init = true;
				}
				else if (gBdDb[channel][uid] == bd) {
					//BD matches, do nothing
				}
				else {
					gBdDb[channel][uid] = bd;

					let bdcnt = 0;
					let xkeys = [];
					let bddb_sorted = Object.fromEntries(Object.entries(gBdDb[channel]).sort());
					for (let userid in bddb_sorted) {
						if (userid == myuid) {
							index = bdcnt;
						}
						xkeys.push(gBdDb[channel][userid]);
						bdcnt++;
					}

					if (bdcnt == pubcnt) {
						//calculate secret key
						let len = BigInt(xkeys.length);
						let skey = modPow(prevkey, len * gMyDhKey[channel].private, gMyDhKey[channel].prime);
						let sub = BigInt(1);
						for (let i = 0; i < xkeys.length; i++) {
							let base = xkeys[(i + index) % xkeys.length];
							let xPow = modPow(base, len - sub, gMyDhKey[channel].prime);
							skey *= xPow;
							sub++;
						}
						skey %= gMyDhKey[channel].prime;
						//console.log("!!! My skey " + skey.toString(16) + " !!!");
						gMyDhKey[channel].secret = skey;

						let rnd = new BLAKE2s(32, gChannelKey[channel]);
						rnd.update(StringToUint8(gMyDhKey[channel].secret.toString(16)));

						gMyDhKey[channel].bdChannelKey = createChannelKey(rnd.digest());
						let key = createMessageKey(rnd.digest());
						let aontkey = createMessageAontKey(rnd.digest());

						gMyDhKey[channel].bdMsgCrypt = createMessageCrypt(key, aontkey);
						//console.log("Created key msg crypt! " + key)

						rnd = '';
						key = '';
						aontkey = '';
					}
				}
				//if bd handling fails, ignore large handling
				if (!init && (msgtype & MSGISBDACK)) {
					if (gMyDhKey[channel].secretAcked) {
						//do nothing, already acked
					}
					else {
						if(!gBdAckDb[channel])
							gBdAckDb[channel] = {};
						//check first that pub and bd are ok
						if (gDhDb[channel][uid] && gBdDb[channel][uid]) {
							gBdAckDb[channel][uid] = true;
							let pubcnt = Object.keys(gDhDb[channel]).length;
							let bdcnt = Object.keys(gBdDb[channel]).length;
							let ackcnt = Object.keys(gBdAckDb[channel]).length;
							//ack received from everyone else?
							//console.log("Ackcnt " + ackcnt + " pubcnt " + pubcnt + " bdcnt " + bdcnt);
							if (pubcnt == bdcnt && ackcnt == pubcnt &&
								(message.length == DH_BITS/8 && (msgtype & MSGISBDACK) && (msgtype & MSGISBDONE) && pubcnt == 2 ||
								 message.length == 2 * (DH_BITS/8) && (msgtype & MSGISBDACK) && pubcnt > 2)) {

								//console.log("Ack count matches to pub&bdcnt, enabling send encryption!");
								gMyDhKey[channel].secretAcked = true;
							}
						}
						else {
							//start again
							initBd(channel, myuid);
							if(BDDEBUG)
								console.log("!!! bds invalidated in ack !!!");
						}
					}
				}
			}
		}
	}
	return msgtype;
}

function processOnMessageData(channel, msg) {
	//sanity
	if (msg.message.byteLength <= NONCE_LEN || msg.message.byteLength > 0xffffff) {
		return;
	}

	let fsEnabled = false;
	let noncem = msg.message.slice(0, NONCE_LEN);
	let arr = msg.message.slice(NONCE_LEN, msg.message.byteLength - HMAC_LEN);
	let hmac = msg.message.slice(msg.message.byteLength - HMAC_LEN, msg.message.byteLength)
	let message = Uint8ToString(arr);

	//verify first hmac
	let hmacarr = new Uint8Array(noncem.byteLength + arr.byteLength);
	hmacarr.set(noncem, 0);
	hmacarr.set(arr, noncem.byteLength);
	let hmacok = false;
	let crypt; //selected crypt object

	//try all three options
	if(gMyDhKey[channel].bdMsgCrypt) {
		let blakehmac = new BLAKE2s(HMAC_LEN, gMyDhKey[channel].bdChannelKey);
		blakehmac.update(DOMAIN_AUTHKEY);
		blakehmac.update(noncem.slice(2));
		blakehmac.update(hmacarr);
		let rhmac = blakehmac.digest();
		if (true == isEqualHmacs(hmac, rhmac)) {
			hmacok = true;
			crypt = gMyDhKey[channel].bdMsgCrypt;
			//console.log("Current crypt matches");
			fsEnabled = true;
		}
	}
	if(!hmacok && gMyDhKey[channel].prevBdMsgCrypt) {
		let blakehmac = new BLAKE2s(HMAC_LEN, gMyDhKey[channel].prevBdChannelKey);
		blakehmac.update(DOMAIN_AUTHKEY);
		blakehmac.update(noncem.slice(2));
		blakehmac.update(hmacarr);
		let rhmac = blakehmac.digest();
		if (true == isEqualHmacs(hmac, rhmac)) {
			hmacok = true;
			crypt = gMyDhKey[channel].prevBdMsgCrypt;
			//console.log("Prev crypt matches");
			fsEnabled = true;
		}
	}
	if(!hmacok) {
		let blakehmac = new BLAKE2s(HMAC_LEN, gChannelKey[channel]);
		blakehmac.update(DOMAIN_AUTHKEY);
		blakehmac.update(noncem.slice(2));
		blakehmac.update(hmacarr);
		let rhmac = blakehmac.digest();
		if (false == isEqualHmacs(hmac, rhmac)) {
			return;
		}
		crypt = gMsgCrypt[channel];
	}

	let nonce = u8arr2nonce(noncem);
	let iv = nonce.slice(0, 2);

	let uid = gChanCrypt[channel].trimZeros(gChanCrypt[channel].decrypt(atob(msg.uid)));
	let decrypted = crypt.decrypt(message, iv);

	if (decrypted.length < HDRLEN) {
		return;
	}

	let decompressed = LZString.decompress(decrypted);
	if (null == decompressed) {
		return;
	}

	let versizestr = decompressed.slice(0, 8);
	let varray = crypt.split64by32(versizestr);
	const msgsz = unscatterU16(varray[0], varray[1]);

	let keysizestr = decompressed.slice(8, 16);
	let karray = crypt.split64by32(keysizestr);
	let keysz = unscatterU16(karray[0], karray[1]);

	//let padsz = decompressed.length - msgsz - keysz;
	//console.log("RX: Len " + decompressed.length + " Msgsize " + msgsz + " Keysz " + keysz + " Pad size " + padsz);

	let timestring = decompressed.slice(16, 24);
	let rarray = crypt.split64by32(timestring);
	let timeU16 = unscatterU16(rarray[0], rarray[1]);
	let weekstring = decompressed.slice(24, 32);
	let warray = crypt.split64by32(weekstring);
	let weekU16 = unscatterU16(warray[0], warray[1]);
	let flagstring = decompressed.slice(32, HDRLEN);
	let farray = crypt.split64by32(flagstring);
	let flagU16 = unscatterU16(farray[0], farray[1]);

	let msgDate = readTimestamp(timeU16, weekU16, flagU16 & ALLISSET);

	message = decompressed.slice(HDRLEN, msgsz);

	let msgtype = 0;
	if (flagU16 & ISFULL)
		msgtype |= MSGISFULL;
	if (flagU16 & ISDATA)
		msgtype |= MSGISDATA;
	if (flagU16 & ISPRESENCE)
		msgtype |= MSGISPRESENCE;
	if (flagU16 & ISPRESENCEACK)
		msgtype |= MSGISPRESENCEACK;
	if (flagU16 & ISMULTI)
		msgtype |= MSGISMULTIPART;
	if (flagU16 & ISFIRST)
		msgtype |= MSGISFIRST;
	if (flagU16 & ISLAST)
		msgtype |= MSGISLAST;
	if (flagU16 & ISBDONE)
		msgtype |= MSGISBDONE;
	if (flagU16 & ISBDACK)
		msgtype |= MSGISBDACK;

	if(keysz > 0) {
		const keystr = decompressed.slice(msgsz, msgsz+keysz);
		msgtype = processBd(channel, uid, msgtype, msgDate.valueOf(), keystr);
	}

	postMessage(["data", uid, channel, msgDate.valueOf(), message, msgtype, fsEnabled]);
}

function msgDecode(data) {
	try {
		return CBOR.decode(data);
	} catch (err) {
		return null;
	}
}

function msgEncode(obj) {
	try {
		return CBOR.encode(obj);
	} catch (err) {
		return null;
	}
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function processOnClose(channel) {
	gWebSocket[channel].close();
	let uid = gChanCrypt[channel].trimZeros(gChanCrypt[channel].decrypt(atob(gMyUid[channel])));
	postMessage(["close", uid, channel]);
}

function processOnOpen(channel, reopen) {
	let uid = gChanCrypt[channel].trimZeros(gChanCrypt[channel].decrypt(atob(gMyUid[channel])));
	if(false == reopen) {
		postMessage(["init", uid, channel]);
	}
	else {
		postMessage(["resync", uid, channel]);
	}
}

function processOnForwardSecrecy(channel, bdKey) {
	let uid = gChanCrypt[channel].trimZeros(gChanCrypt[channel].decrypt(atob(gMyUid[channel])));
	postMessage(["forwardsecrecy", uid, channel, bdKey.toString(16)]);
}

function processOnForwardSecrecyOff(channel) {
	let uid = gChanCrypt[channel].trimZeros(gChanCrypt[channel].decrypt(atob(gMyUid[channel])));
	postMessage(["forwardsecrecyoff", uid, channel]);
}

function isSocketOpen(channel) {
	if (gWebSocket[channel] !== undefined && gWebSocket[channel].readyState == WebSocket.OPEN) {
		return true;
	}
	return false;
}

async function openSocket(channel, port, addr, reopen = false) {
	if (isSocketOpen(channel) && false == reopen) {
		return;
	}
	if (gWebSocket[channel] !== undefined) {
		gWebSocket[channel].close();
		await sleep(RECREATE_TIMER);
	}
	gWebSocket[channel] = new WebSocket("wss://" + addr + ":" + port, "mles-websocket");
	gWebSocket[channel].binaryType = "arraybuffer";
	gWebSocket[channel].onopen = function (event) {
		let ret = processOnOpen(channel, reopen);
		if(ret < 0)
			console.log("Process on open failed: " + ret);

	};

	gWebSocket[channel].onmessage = function (event) {
		if (event.data) {
			let msg = msgDecode(event.data);
			if(!msg)
				return;

			let ret = processOnMessageData(channel, msg);
			if(ret < 0)
				console.log("Process on message data failed: " + ret);
		}
	};

	gWebSocket[channel].onclose = function (event) {
		let ret = processOnClose(channel);
		if(ret < 0)
			console.log("Process on close failed: " + ret)
	};
}

function createChannelKey(key) {
	if(key.length > 32)
		throw new RangeError("Too large key " + key.length);
	let round = new BLAKE2s(32, key);
	round.update(DOMAIN_CHANKEY);
	let blakecb = new BLAKE2s(7, key); //56-bits max key len
	blakecb.update(DOMAIN_CHANKEY);
	blakecb.update(round.digest());
	return blakecb.digest();
}

function createChannelAontKey(key) {
	if(key.length > 32)
		throw new RangeError("Too large key " + key.length);
	let round = new BLAKE2s(32, key);
	round.update(DOMAIN_CHANKEY);
	round.update(key);
	let blakeaontecb = new BLAKE2s(8, key); //aont key len
	blakeaontecb.update(DOMAIN_CHANKEY);
	blakeaontecb.update(round.digest());
	return blakeaontecb.digest();
}

function createMessageKey(key) {
	if(key.length > 32)
		throw new RangeError("Too large key " + key.length);
	let blakecbc = new BLAKE2s(7, key); //56-bits max key len
	blakecbc.update(DOMAIN_ENCKEY);
	return blakecbc.digest();
}

function createMessageAontKey(key) {
	if(key.length > 32)
		throw new RangeError("Too large key " + key.length);
	let round = new BLAKE2s(32, key);
	round.update(DOMAIN_ENCKEY);
	round.update(key);
	round.update(key);
	let blakeaontcbc = new BLAKE2s(8, key); //aont key len
	blakeaontcbc.update(round.digest());
	return blakeaontcbc.digest();
}

function createChannelCrypt(channelKey, channelAontKey) {
	return new Blowfish(channelKey, channelAontKey);
}

function createMessageCrypt(messageKey, messageAontKey) {
	return new Blowfish(messageKey, messageAontKey, "cbc");
}

function checkPrime(candidate) {
	return isPrime(fromBuffer(candidate))
}

function isPrime(candidate) {
	// Testing if a number is a probable prime (Miller-Rabin)
	const number = BigInt(candidate)
	const isPrime = _isProbablyPrime(number, 6)
	//if(isPrime) {
  	//	console.log(number.toString(16) +  " is prime")
	//}
	return isPrime;
}

function getDhPrime(bits, key) {
	let sprime = 0;

	//let rounds = 0;
	//console.time("getDhPrime");
	if(bits <= 0 || bits % 512 || bits > 4096)
		throw new RangeError("Invalid key bits" + bits);

	let rnd = new BLAKE2s(32, key);
	let seed = rnd.digest();
	let dhhprime = new BLAKE2s(32, seed);
	let dhlprime = new BLAKE2s(32, dhhprime.digest());
	let aPrime = false;
	let dhprime = new Uint8Array(bits/8);

	while (false == aPrime) {
		let cnt = 0;
		while(cnt < bits/8) {
			dhhprime = new BLAKE2s(32, dhlprime.digest());
			dhlprime = new BLAKE2s(32, dhhprime.digest());

			let hival = dhhprime.digest();
			for (let i = 0; i < 32; i++) {
				dhprime[cnt++] = hival[i];
			}
			let loval = dhlprime.digest();
			for (let i = 0; i < 32; i++) {
				dhprime[cnt++] = loval[i];
			}
		}
		dhprime[0] |= 0x80;
		dhprime[bits / 8 - 1] |= 0x1;
		aPrime = checkPrime(dhprime);
		if (aPrime) {
			sprime = buf2bn(dhprime);
			//qprime = fromBuffer(dhprime);
			//sprime = BigInt(2)*qprime-BigInt(1);
			//aPrime = isPrime(sprime);
		}
		//rounds++;
		//if(0 == rounds % 100)
		//	console.log("Rounds: " + rounds);
	}
	//console.log("Total rounds: " + rounds);
	//console.timeEnd("getDhPrime");
	return sprime;
}

function bn2buf(bn) {
	var hex = BigInt(bn).toString(16);
	if (hex.length % 2) { hex = '0' + hex; }
  
	var len = hex.length / 2;
	var u8 = new Uint8Array(len);
  
	var i = 0;
	var j = 0;
	while (i < len) {
	  u8[i] = parseInt(hex.slice(j, j+2), 16);
	  i += 1;
	  j += 2;
	}
  
	return u8;
  }

function buf2bn(buf) {
	var hex = [];
	u8 = Uint8Array.from(buf);
  
	u8.forEach(function (i) {
	  var h = i.toString(16);
	  if (h.length % 2) { h = '0' + h; }
	  hex.push(h);
	});
  
	return BigInt('0x' + hex.join(''));
}

const MAXRND = 0x3ff;
/* Padmé: https://lbarman.ch/blog/padme/ */
function padme(msgsize) {
	//const L = msgsize + (rnd & ~msgsize & MAXRND); //with random
	const L = msgsize;
	const E = Math.floor(Math.log2(L));
	const S = Math.floor(Math.log2(E))+1;
	const lastBits = E-S;
	const bitMask = 2 ** lastBits - 1;
	return (L + bitMask) & ~bitMask;
}

function createPrevBd(channel, prevBdKey, channelKey) {
	let rnd = new BLAKE2s(32, channelKey);
	rnd.update(StringToUint8(prevBdKey));

	//console.log("Setting prev channel key and crypt");
	gMyDhKey[channel].prevBdChannelKey = createChannelKey(rnd.digest());
	let key = createMessageKey(rnd.digest());
	let aontkey = createMessageAontKey(rnd.digest());
	gMyDhKey[channel].prevBdMsgCrypt = createMessageCrypt(key, aontkey);
}

onmessage = function (e) {
	let cmd = e.data[0];
	let data = e.data[1];

	switch (cmd) {
		case "init":
			{
				let addr = e.data[2];
				let port = e.data[3];
				let uid = e.data[4];
				let channel = e.data[5];
				let passwd = StringToUint8(e.data[6]);
				let prevBdKey = e.data[7];
				gMyDhKey[channel] = {
					prime: BigInt(0),
       					generator: BigInt(DH_GENERATOR),
					private: BigInt(0),
					public: BigInt(0),
					bd: BigInt(0),
	    				secret: BigInt(0),
	    				secretAcked: false,
	    				bdMsgCrypt: null,
	    				bdChannelKey: null,
	    				prevBdMsgCrypt: null,
	    				prevBdChannelKey: null,
	    				fsInformed: false
				};

				gMyAddr[channel] = addr;
				gMyPort[channel] = port;

				//salt
				let salt = new BLAKE2s(SCRYPT_SALTLEN);
				salt.update(passwd);
				salt.update(StringToUint8('salty'));

				//scrypt
				scrypt(passwd, salt.digest(), {
					N: SCRYPT_N,
					r: SCRYPT_R,
					p: SCRYPT_P,
					dkLen: SCRYPT_DKLEN,
					encoding: 'binary'
				}, function(derivedKey) {
					passwd = derivedKey;
				});

				let private = new Uint8Array(DH_BITS/8);
				self.crypto.getRandomValues(private);

				gMyDhKey[channel].prime = getDhPrime(DH_BITS, passwd);
				gMyDhKey[channel].private = buf2bn(private);
				gMyDhKey[channel].public = modPow(gMyDhKey[channel].generator, gMyDhKey[channel].private, gMyDhKey[channel].prime);
				//init and update database
				gDhDb[channel] = {};
				gDhDb[channel][uid] = gMyDhKey[channel].public;

				gChannelKey[channel] = createChannelKey(passwd);
				if(prevBdKey) {
					createPrevBd(channel, prevBdKey, gChannelKey[channel]);
				}

				let channelAontKey = createChannelAontKey(passwd);
				let messageKey = createMessageKey(passwd);
				let messageAontKey = createMessageAontKey(passwd)

				gChanCrypt[channel] = createChannelCrypt(gChannelKey[channel], channelAontKey);	
				gMsgCrypt[channel] = createMessageCrypt(messageKey, messageAontKey);
				gMyUid[channel] = btoa(gChanCrypt[channel].encrypt(uid));
				gMyChannel[channel] = btoa(gChanCrypt[channel].encrypt(channel));

				//wipe unused
				salt = "";
				passwd = "";
				channelAontKey = "";
				messageKey = "";
				messageAontKey = "";
				prevBdKey = "";

				openSocket(channel, gMyPort[channel], gMyAddr[channel], false);
			}
			break;
		case "reconnect":
			{
				let uid = e.data[2];
				let channel = e.data[3];
                                let prevBdKey = e.data[4];

				if(isSocketOpen(channel)) { //do not reconnect if socket is already connected
					break;
				}
 
                                let private = new Uint8Array(DH_BITS/8);
                                self.crypto.getRandomValues(private);

                                gMyDhKey[channel].private = buf2bn(private);
                                gMyDhKey[channel].public = modPow(gMyDhKey[channel].generator, gMyDhKey[channel].private, gMyDhKey[channel].prime);
                                if(prevBdKey) {
                                        createPrevBd(channel, prevBdKey, gChannelKey[channel]);
				}

                                //update database
                                initDhBd(channel, uid);

                                //wipe unused
                                prevBdKey = ""; 

				let myuid = btoa(gChanCrypt[channel].encrypt(uid));
				let mychan = btoa(gChanCrypt[channel].encrypt(channel));
				// verify that we have already opened the channel earlier
				if (gMyUid[channel] === myuid && gMyChannel[channel] === mychan) {
					openSocket(channel, gMyPort[channel], gMyAddr[channel], false);
				}
			}
			break;
		case "resync": // force reconnect
			{
				let uid = e.data[2];
				let channel = e.data[3];
                                let prevBdKey = e.data[4];

                                let private = new Uint8Array(DH_BITS/8);
                                self.crypto.getRandomValues(private);

                                gMyDhKey[channel].private = buf2bn(private);
                                gMyDhKey[channel].public = modPow(gMyDhKey[channel].generator, gMyDhKey[channel].private, gMyDhKey[channel].prime);
                                if(prevBdKey) {
                                        createPrevBd(channel, prevBdKey, gChannelKey[channel]);
				}

                                //update database
                                initDhBd(channel, uid);

                                //wipe unused
                                prevBdKey = ""; 

				let myuid = btoa(gChanCrypt[channel].encrypt(uid));
				let mychan = btoa(gChanCrypt[channel].encrypt(channel));
				// verify that we have already opened the channel earlier
				if (gMyUid[channel] === myuid && gMyChannel[channel] === mychannel) {
					openSocket(channel, gMyPort[channel], gMyAddr[channel], true);
				}
			}
			break;
		case "send":
		case "resend_prev":
			{
				let uid = e.data[2];
				let channel = e.data[3];
				let msgtype = e.data[4];
				let valueofdate = e.data[5];
				let keysz = 0;

				let randarr = new Uint32Array(18);
				self.crypto.getRandomValues(randarr);

				let iv = randarr.slice(0, 2);
				let nonce = randarr.slice(0, 8);
				let rarray = randarr.slice(8);

				let weekstamp = createWeekstamp(valueofdate);
				let timestamp = createTimestamp(valueofdate, weekstamp);
				let flagstamp = createFlagstamp(valueofdate, weekstamp, timestamp); //include seconds to flagstamp

				if (msgtype & MSGISFULL)
					flagstamp |= ISFULL;

				if (msgtype & MSGISDATA)
					flagstamp |= ISDATA;

				if (msgtype & MSGISPRESENCE)
					flagstamp |= ISPRESENCE;

				if (msgtype & MSGISPRESENCEACK)
					flagstamp |= ISPRESENCEACK;

				if (msgtype & MSGISMULTIPART) {
					flagstamp |= ISMULTI;
					if (msgtype & MSGISFIRST) {
						flagstamp |= ISFIRST;
					}
					if (msgtype & MSGISLAST) {
						flagstamp |= ISLAST;
					}
				}
				const msgsz = data.length + HDRLEN;
				let newmessage;
				let encrypted;
				let crypt;
				let channel_key;
				let padlen = 0;
				if(cmd == "send") {
					//add public key, if it exists
					if (gMyDhKey[channel].public) {
						let pub = Uint8ToString(bn2buf(gMyDhKey[channel].public));
						keysz += pub.length;
						data += pub;
					}
					//add BD key, if it exists
					if (gMyDhKey[channel].bd && !(msgtype & MSGISPRESENCEACK)) {
						if(gMyDhKey[channel].bd == BigInt(1)) {
							flagstamp |= ISBDONE;
							padlen += DH_BITS/8;
						}
						else {
							let bd = Uint8ToString(bn2buf(gMyDhKey[channel].bd));
							keysz += bd.length;
							data += bd;
						}
						let pubcnt = Object.keys(gDhDb[channel]).length;
						let bdcnt = Object.keys(gBdDb[channel]).length;
						//console.log("During send pubcnt " + pubcnt + " bdcnt " + bdcnt)
						if (pubcnt == bdcnt && gMyDhKey[channel].secret != BigInt(0)) {
							flagstamp |= ISBDACK;
							if (gBdAckDb[channel][uid] == null) {
								//console.log("Adding self to bdack db");
								gBdAckDb[channel][uid] = true;
							}
						}
					}
					else {
						padlen += DH_BITS/8;
					}
					if (gMyDhKey[channel].bdMsgCrypt && gMyDhKey[channel].secret && gMyDhKey[channel].secretAcked) {
						if (!gMyDhKey[channel].fsInformed) {
							processOnForwardSecrecy(channel, gMyDhKey[channel].secret);
							gMyDhKey[channel].fsInformed = true;
						}
						crypt = gMyDhKey[channel].bdMsgCrypt;
						channel_key = gMyDhKey[channel].bdChannelKey;
					}
					else {
						crypt = gMsgCrypt[channel];
						channel_key = gChannelKey[channel];
					}
				}
				else if (gMyDhKey[channel].prevBdMsgCrypt && gMyDhKey[channel].prevBdChannelKey) { //resend_prev
					crypt = gMyDhKey[channel].prevBdMsgCrypt;
					channel_key = gMyDhKey[channel].prevBdChannelKey;
				}

				if(!crypt || !channel_key) {
					//ignore msg
					break;
				}

				//version and msg size
				let hval = scatterU16(rarray[0], rarray[1], msgsz);
				rarray[1] = hval;
				//key size
				let kval = scatterU16(rarray[2], rarray[3], keysz);
				rarray[3] = kval;
				//time vals
				let sval = scatterU16(rarray[4], rarray[5], timestamp);
				rarray[5] = sval;
				sval = scatterU16(rarray[6], rarray[7], weekstamp);
				rarray[7] = sval;
				sval = scatterU16(rarray[8], rarray[9], flagstamp);
				rarray[9] = sval;

				//version, size and key values
				newmessage = crypt.num2block32(rarray[0]) + crypt.num2block32(rarray[1]) +
							crypt.num2block32(rarray[2]) + crypt.num2block32(rarray[3]);
				//time values
				newmessage += crypt.num2block32(rarray[4]) + crypt.num2block32(rarray[5]) +
							crypt.num2block32(rarray[6]) + crypt.num2block32(rarray[7]) +
							crypt.num2block32(rarray[8]) + crypt.num2block32(rarray[9])
				//message itself
				newmessage += data;

				newmessage = LZString.compress(newmessage);

				const msglen = newmessage.length;
				//padmé padding
				const padsz = padme(msglen + padlen) - msglen;
				//console.log("TX: Total msgsize " + (msglen + padsz) + " Msglen " + msglen + " padlen " + padlen + " padding sz " + padsz + " keysz " + keysz)
				if(padsz > 0) {
					newmessage += Uint8ToString(randBytesSync(padsz));
				}

				encrypted = crypt.encrypt(newmessage, iv);
				
				let noncearr = nonce2u8arr(nonce);
				let arr = StringToUint8(encrypted);

				// calculate hmac
				let hmacarr = new Uint8Array(noncearr.byteLength + arr.byteLength);
				hmacarr.set(noncearr, 0);
				hmacarr.set(arr, noncearr.byteLength);

				let blakehmac = new BLAKE2s(HMAC_LEN, channel_key);
				blakehmac.update(DOMAIN_AUTHKEY);
				blakehmac.update(noncearr.slice(2));
				blakehmac.update(hmacarr);
				let hmac = blakehmac.digest();

				let newarr = new Uint8Array(noncearr.byteLength + arr.byteLength + hmac.byteLength);
				newarr.set(noncearr, 0);
				newarr.set(arr, noncearr.byteLength);
				newarr.set(hmac, noncearr.byteLength + arr.byteLength);
				let obj = {
					uid: btoa(gChanCrypt[channel].encrypt(uid)),
					channel: btoa(gChanCrypt[channel].encrypt(channel)),
					message: newarr
				};
				let encodedMsg = msgEncode(obj);
				if(!encodedMsg)
					break;
				try {
					gWebSocket[channel].send(encodedMsg);
				} catch (err) {
					break;
				}
			}
			break;
		case "close":
			{
				let uid = e.data[2];
				let channel = e.data[3];
				gWebSocket[channel].close();
				initDhBd(channel, uid);
				initPrevDhBd(channel, uid);
			}
			break;
	}
}

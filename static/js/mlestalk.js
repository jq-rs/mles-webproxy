/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) 2019-2020 MlesTalk developers
 */
let gMyName = '';
let gMyChannel = '';
let gMyAddr = '';
let gMyPort = '';
let gMyToken = null;
let gAddrPortInput = '';
let gOwnId = 0;
let gOwnAppend = false;
let gIdHash = {};
let gIdAppend = {};
let gIdTimestamp = {};
let gIdNotifyTs = {};
let gIdLastMsgHash = {};
let gIdReconnSync = {};

let gUidQueue = {};

const IMGMAXSIZE = 960; /* px */
const IMGFRAGSIZE = 512 * 1024;

let gInitOk = false;
const RETIMEOUT = 1500; /* ms */
const MAXTIMEOUT = 1000 * 60 * 5; /* ms */
const MAXQLEN = 32;
const RESYNC_TIMEOUT = 15000; /* ms */
const LED_ON_TIME = 500; /* ms */
const LED_OFF_TIME = 2500; /* ms */
const SCROLL_TIME = 500; /* ms */
const ASYNC_SLEEP = 3 /* ms */
let gReconnTimeout = RETIMEOUT;
let gReconnAttempts = 0;

const DATELEN = 13;

let gIsTokenChannel = false;
let gSipKey;
let gSipKeyIsOk = false;
let gIsResync = false;
let gLastWrittenMsg = "";

let gLastMessageSeenTs = 0;
let gLastReconnectTs = 0;
let gLastMessage = {};
let gLastMessageSendOrRcvdDate = "";

let gCanNotify = false;
let gWillNotify = false;
let isCordova = false;
let gIsReconnect = false;

let gWeekday = new Array(7);
gWeekday[0] = "Sun";
gWeekday[1] = "Mon";
gWeekday[2] = "Tue";
gWeekday[3] = "Wed";
gWeekday[4] = "Thu";
gWeekday[5] = "Fri";
gWeekday[6] = "Sat";
let gBgTitle = "MlesTalk in the background";
let gBgText = "Notifications active";
let gImageStr = "<an image>";

class Queue {
	constructor(...elements) {
		this.elements = [...elements];
		this.qmax = MAXQLEN;
	}
	push(...args) {
		if (this.getLength() >= this.maxLength())
			this.shift();
		return this.elements.push(...args);
	}
	get(val) {
		if (val >= 0 && val < this.getLength()) {
			return this.elements[val];
		}
	}
	shift() {
		return this.elements.shift();
	}
	unshift() {
		return this.elements.unshift();
	}
	flush(val) {
		if (val > 0 && val <= this.getLength()) {
			this.elements.splice(0, val);
		}
	}
	getLength() {
		return this.elements.length;
	}
	maxLength() {
		return this.qmax;
	}
}

function hash_message(uid, data) {
	return SipHash.hash_hex(gSipKey, uid + data);
}

function uidQueueGet(uid) {
	return gUidQueue[uid];
}

function queueFindAndMatch(msgTimestamp, uid, data) {
	let q = uidQueueGet(uid);
	if (q) {
		let lastSeen = -1;
		for (let i = 0; i < q.getLength(); i++) {
			let obj = q.get(i);
			if (obj[0] < msgTimestamp) {
				lastSeen = i + 1;
				continue;
			}
			let hash = hash_message(uid, data);
			if (obj[2] == hash) {
				lastSeen = i + 1;
				break;
			}
		}
		if (lastSeen != -1) {
			q.flush(lastSeen);
		}
	}
}

function queueSweepAndSend(uid) {
	let q = uidQueueGet(uid);
	let cnt = 0;
	if (q) {
		for (let i = 0; i < q.getLength(); i++) {
			let obj = q.get(i);
			let tmp = obj[1];
			if (tmp[2] == uid) {
				gWebWorker.postMessage(tmp);
				cnt++;
				gIdLastMsgHash[tmp[2]] = hash_message(tmp[2], tmp[1]);
			}
		}
		for (let userid in gIdReconnSync) {
			gIdReconnSync[userid] = false;
		}
	}
	gIsResync = false;
	console.log("Resync complete: swept " + cnt + " msgs.");
}

function uidQueuePush(uid, arr) {
	if (!gUidQueue[uid]) {
		gUidQueue[uid] = new Queue();
	}
	let q = gUidQueue[uid];
	q.push(arr);
}

function queuePostMsg(uid, arr) {
	uidQueuePush(uid, arr);
}

let autolinker = new Autolinker({
	urls: {
		schemeMatches: true,
		wwwMatches: true,
		tldMatches: true
	},
	email: true,
	phone: false,
	mention: false,
	hashtag: false,

	stripPrefix: true,
	stripTrailingSlash: true,
	newWindow: true,

	truncate: {
		length: 0,
		location: 'end'
	},

	className: ''
});

function stampTime(msgdate) {
	let dd = msgdate.getDate(),
		mm = msgdate.getMonth() + 1,
		yyyy = msgdate.getFullYear(),
		h = msgdate.getHours(),
		m = msgdate.getMinutes(),
		day = gWeekday[msgdate.getDay()];
	if (dd < 10) dd = '0' + dd;
	if (mm < 10) mm = '0' + mm;
	if (m < 10) m = '0' + m;
	return day + ' ' + dd + '.' + mm + '.' + yyyy + ' ' + h + ':' + m;
}

function timeNow() {
	return stampTime(new Date());
}

let gWebWorker = new Worker('webworker/js/webworker.js');

function onPause() {
	gWillNotify = true;
	if (isCordova) {
		if (!cordova.plugins.backgroundMode.isActive()) {
			cordova.plugins.backgroundMode.enable();
		}
		cordova.plugins.backgroundMode.toBackground();
		cordova.plugins.notification.badge.clear();
		cordova.plugins.notification.local.clearAll();
	}
}

function onResume() {
	gWillNotify = false;
	if (isCordova) {
		cordova.plugins.notification.local.clearAll();
		cordova.plugins.notification.badge.clear();
		cordova.plugins.backgroundMode.fromBackground();
	}
}

function onBackKeyDown() {
	//do nothing
}


let interval;
function onLoad() {
	document.addEventListener("deviceready", function () {
		cordova.plugins.notification.local.requestPermission(function (granted) {
			gCanNotify = granted;
		});

		cordova.plugins.backgroundMode.setDefaults({
			title: gBgTitle,
			text: gBgText
		});

		cordova.plugins.notification.local.setDefaults({
			led: { color: '#77407B', on: LED_ON_TIME, off: LED_OFF_TIME },
			vibrate: true
		});

		// sets an recurring alarm that keeps things rolling
		cordova.plugins.backgroundMode.disableWebViewOptimizations();
		cordova.plugins.backgroundMode.enable();

		document.addEventListener("pause", onPause, false);
		document.addEventListener("resume", onResume, false);
		document.addEventListener("backbutton", onBackKeyDown, false);

		isCordova = true;
	}, false);

	getFront();
}

$(document).ready(function () {
	let url_string = window.location.href;
	let url = new URL(url_string);
	gMyToken = url.searchParams.get("token");
	$("#channel_submit, #form_send_message").submit(function (e) {
		e.preventDefault();
		askChannel();
	});
});


function askChannel() {
	if ($('#input_name').val().trim().length <= 0 ||
		(gMyToken == null && $('#input_channel').val().trim().length <= 0) ||
		$('#input_key').val().trim().length <= 0) {

		//not enough input, alert
		popAlert();

	} else {
		if (!gInitOk) {
			if (gMyToken != null) {
				let token = gMyToken.trim();
				token = token.split(' ').join('+');
				token = atob(token);
				let atoken = token.substring(0, 16);
				let bfchannel = token.substr(16);
				gSipKey = SipHash.string16_to_key(bfchannel);
				let newtoken = SipHash.hash_hex(gSipKey, bfchannel);
				if (atoken != newtoken) {
					alert('Invalid token');
					return;
				}
				gSipKeyIsOk = true;
				gMyChannel = btoa(bfchannel);
				gIsTokenChannel = true;
			}
			else {
				gMyChannel = $('#input_channel').val().trim();
			}

			gMyName = $('#input_name').val().trim();
			let fullkey = $('#input_key').val().trim();
			gAddrPortInput = $('#input_addr_port').val().trim();
			let localization = $('#channel_localization').val().trim();

			//add to local storage
			if (gAddrPortInput.length > 0) {
				window.localStorage.setItem('gAddrPortInput', gAddrPortInput);
			}
			else {
				window.localStorage.setItem('gAddrPortInput', "mles.io:443");
			}

			//add to local storage
			if (localization.length > 0) {
				window.localStorage.setItem('localization', localization);
			}
			else {
				window.localStorage.setItem('localization', "gb");
			}

			let addrarray = gAddrPortInput.split(":");
			if (addrarray.length > 0) {
				gMyAddr = addrarray[0];
			}
			if (addrarray.length > 1) {
				gMyPort = addrarray[1];
			}
			if (gMyAddr == '') {
				gMyAddr = 'mles.io';
			}
			if (gMyPort == '') {
				gMyPort = '443';
			}

			$('#name_channel_cont').fadeOut(400, function () {
				gWebWorker.postMessage(["init", null, gMyAddr, gMyPort, gMyName, gMyChannel, fullkey, gIsTokenChannel]);
				$('#message_cont').fadeIn();
			});
		}
	}
	return false;
}

function sendEmptyJoin() {
	sendMessage("", false);
}

function sendInitJoin() {
	sendMessage("", true);
}

function send(isFull) {
	let message = $('#input_message').val();
	//let file = document.getElementById("input_file").files[0];

	//if (file) {
	//	sendImage(file);
	//	document.getElementById("input_file").value = "";
	//}
	//else {
		sendMessage(message, isFull);
	//}
}

function chanExit() {
	closeSocket();
}

function closeSocket() {
	initReconnect();
	gInitOk = false;

	//init all databases
	for (let userid in gIdTimestamp) {
		gIdTimestamp[userid] = 0;
	}
	for (let userid in gIdReconnSync) {
		gIdReconnSync[userid] = false;
	}
	for (let userid in gIdNotifyTs) {
		gIdNotifyTs[userid] = 0;
	}
	for (let userid in gIdLastMsgHash) {
		gIdLastMsgHash[userid] = 0;
	}
	for (let duid in gIdHash) {
		gIdHash[duid] = null;
	}
	for (let duid in gIdAppend) {
		gIdAppend[duid] = false;
	}

	gLastMessageSeenTs = 0;

	let q = uidQueueGet(gMyName);
	if(q) {
		//empty send queue
		q.flush(q.getLength());
	}

	//guarantee that websocket gets closed without reconnect
	let tmpname = gMyName;
	let tmpchannel = gMyChannel;
	gMyName = '';
	gMyChannel = '';
	gWebWorker.postMessage(["close", null, tmpname, tmpchannel, gIsTokenChannel]);

	$("#input_channel").val('');
	$("#input_key").val('');
	if (!gIsTokenChannel)
		$('#qrcode').fadeOut();
	$('#message_cont').fadeOut(400, function () {
		$('#name_channel_cont').fadeIn();
		$('#messages').html('');
	});
}

function initReconnect() {
	gReconnTimeout = RETIMEOUT;
	gReconnAttempts = 0;
	gIsReconnect = false;
}

function processInit(uid, channel, myuid, mychan) {
	if (uid.length > 0 && channel.length > 0) {
		gInitOk = true;
		sendInitJoin();

		let li;
		if (gIsReconnect && gLastMessageSeenTs > 0) {
			for (let userid in gIdReconnSync) {
				gIdReconnSync[userid] = true;
			}
			gLastReconnectTs = gLastMessageSeenTs;
		}
		else {
			if (!gIsTokenChannel) {
				li = '<li class="new"> - <span class="name">' + uid + "@" + channel + '</span> - </li>';
			}
			else {
				li = '<li class="new"> - <span class="name">' + uid + '</span> - </li>';
			}
			$('#messages').append(li);
		}

		if (!gIsTokenChannel) {
			//use channel to create 128 bit secret key
			let bfchannel = atob(mychan);
			gSipKey = SipHash.string16_to_key(bfchannel);
			gSipKeyIsOk = true;
			let atoken = SipHash.hash_hex(gSipKey, bfchannel);
			atoken = atoken + bfchannel;
			token = btoa(atoken);
			document.getElementById("qrcode_link").setAttribute("href", getToken());
			qrcode.clear(); // clear the code.
			qrcode.makeCode(getToken()); // make another code.
			$('#qrcode').fadeIn();
		}
		return 0;
	}
	return -1;
}

function processData(uid, channel, msgTimestamp,
	message, isFull, isImage,
	isMultipart, isFirst, isLast) {

	//update hash
	let duid = uid.split(' ').join('_');
	if (gIdHash[duid] == null) {
		gIdHash[duid] = 0;
		gIdAppend[duid] = false;
		gIdTimestamp[uid] = msgTimestamp;
		gIdNotifyTs[uid] = 0;
		gIdLastMsgHash[uid] = 0;
		gIdReconnSync[uid] = false;
	}

	let dateString = "[" + stampTime(new Date(msgTimestamp)) + "] ";

	//begin presence time per user (now)

	if (uid == gMyName) {
		if (!gIsResync) {
			console.log("Resyncing");
			gIsResync = true;
			resync(gMyName);
		}
		if ((isFull && message.length > 0) || (!isFull && message.length == 0)) /* Full or presence message */
			queueFindAndMatch(msgTimestamp, uid, message);
	}
	else if (gOwnId > 0 && message.length >= 0 && gLastWrittenMsg.length > 0) {
		let end = "</li></div>";
		//console.log("Got presence update from " + uid);
		gLastWrittenMsg = gLastWrittenMsg.substring(0, gLastWrittenMsg.length - end.length);
		gLastWrittenMsg += " &#x2713;" + end;
		$('#owner' + (gOwnId - 1)).replaceWith(gLastWrittenMsg);
		gLastWrittenMsg = "";
		//update presence if current time per user is larger than begin presence
	}

	if (isMultipart) {
		if (!gMultipartDict[uid + channel]) {
			if (!isFirst) {
				//invalid frame
				return 0;
			}
			gMultipartDict[uid + channel] = "";
		}
		gMultipartDict[uid + channel] += message;
		if (!isLast) {
			return 0;
		}
		message = gMultipartDict[uid + channel];
		gMultipartDict[uid + channel] = null;
	}

	if (gIdTimestamp[uid] <= msgTimestamp) {
		let li;
		let date;
		let time;

		if (isFull && 0 == message.length) /* Ignore init messages in timestamp processing */
			return 0;

		if (!gIdReconnSync[uid]) {
			gIdLastMsgHash[uid] = hash_message(uid, isFull ? msgTimestamp + message + '\n' : msgTimestamp + message);
		}
		else if (msgTimestamp >= gIdTimestamp[uid]) {
			let mHash = hash_message(uid, isFull ? msgTimestamp + message + '\n' : msgTimestamp + message);
			if (mHash == gIdLastMsgHash[uid]) {
				gIdReconnSync[uid] = false;
				gIdTimestamp[uid] = msgTimestamp;
			}
			return 0;
		}
		gIdTimestamp[uid] = msgTimestamp;
		if (gLastMessageSeenTs < msgTimestamp)
			gLastMessageSeenTs = msgTimestamp;

		if (0 == message.length)
			return 1;

		date = update_dateval(dateString);
		if (date) {
			/* Update new date header */
			li = '<li class="new"> - <span class="name">' + date + '</span> - </li>';
			$('#messages').append(li);
		}
		time = update_time(dateString);

		/* Check first is it a text or image */
		if (isImage) {
			if (uid != gMyName) {
				li = '<div id="' + duid + '' + gIdHash[duid] + '"><li class="new"><span class="name">' + uid + '</span> ' + time +
					'<img class="image" src="' + message + '" height="100px" data-action="zoom" alt="">';

			}
			else {
				li = '<div id="' + duid + '' + gIdHash[duid] + '"><li class="own"> ' + time
					+ '<img class="image" src="' + message + '" height="100px" data-action="zoom" alt="">';

			}
			li += '</li></div>';
		}
		else {
			if (uid != gMyName) {
				li = '<div id="' + duid + '' + gIdHash[duid] + '"><li class="new"><span class="name"> ' + uid + '</span> '
					+ time + "" + autolinker.link(message) + '</li></div>';
			}
			else {
				li = '<div id="' + duid + '' + gIdHash[duid] + '"><li class="own"> ' + time + "" + autolinker.link(message) + '</li></div>';
			}
		}

		if (false == gIdAppend[duid]) {
			$('#messages').append(li);
			gIdAppend[duid] = true;
		}

		if (isFull) {
			gIdHash[duid] = gIdHash[duid] + 1;
			gIdAppend[duid] = false;
			if (isCordova && gLastReconnectTs < msgTimestamp) {
				cordova.plugins.notification.badge.increase();
			}
		}
		else if (true == gIdAppend[duid]) {
			$('#' + duid + '' + gIdHash[duid]).replaceWith(li);
		}

		if (isFull || $('#input_message').val().length == 0) {
			scrollToBottom();
		}

		if (uid != gMyName && isFull && gIdNotifyTs[uid] < msgTimestamp) {
			if (gWillNotify && gCanNotify) {
				if (true == isImage) {
					message = gImageStr;
				}
				doNotify(uid, channel, msgTimestamp, message);
			}
			gIdNotifyTs[uid] = msgTimestamp;
		}
	}
	return 0;
}

function processSend(uid, channel, isMultipart) {
	if (isMultipart) {
		if (gMultipartSendDict[uid + channel]) {
			multipartContinue = true;
		}
	}
	return 0;
}

function processClose(uid, channel, mychan) {
	gIsReconnect = false;
	if (uid == gMyName && gIsTokenChannel ? mychan == gMyChannel : channel == gMyChannel) {
		reconnect(uid, gIsTokenChannel ? mychan : channel);
	}
}

let gMultipartDict = {};
let gMultipartSendDict = {};
let multipartContinue = false;
gWebWorker.onmessage = function (e) {
	let cmd = e.data[0];
	switch (cmd) {
		case "init":
			{
				let uid = e.data[1];
				let channel = e.data[2];
				let myuid = e.data[3];
				let mychan = e.data[4];

				let ret = processInit(uid, channel, myuid, mychan);
				if (ret < 0) {
					console.log("Process init failed: " + ret);
				}
			}
			break;
		case "data":
			{
				let uid = e.data[1];
				let channel = e.data[2];
				let msgTimestamp = e.data[3];
				let message = e.data[4];
				let isFull = e.data[5];
				let isImage = e.data[6];
				let isMultipart = e.data[7];
				let isFirst = e.data[8];
				let isLast = e.data[9];

				initReconnect();

				let ret = processData(uid, channel, msgTimestamp,
					message, isFull, isImage,
					isMultipart, isFirst, isLast);
				if (ret < 0) {
					console.log("Process data failed: " + ret);
				}
			}
			break;
		case "send":
			{
				let uid = e.data[1];
				let channel = e.data[2];
				let isMultipart = e.data[3];

				let ret = processSend(uid, channel, isMultipart);
				if (ret < 0) {
					console.log("Process send failed: " + ret);
				}
			}
			break;
		case "close":
			{
				let uid = e.data[1];
				let channel = e.data[2];
				//let myuid = e.data[3];
				let mychan = e.data[4];

				let ret = processClose(uid, channel, mychan);
				if (ret < 0) {
					console.log("Process close failed: " + ret);
				}
			}
			break;
	}
}

function update_dateval(dateString) {
	let lastDate = gLastMessageSendOrRcvdDate;
	const begin = gWeekday[0].length + 2;
	const end = DATELEN + 1;
	if (lastDate != "" &&
		dateString.slice(begin, end) == lastDate.slice(begin, end)) {
		return null;
	}
	else {
		let dateval = dateString.slice(1, DATELEN + gWeekday[0].length - 1);
		gLastMessageSendOrRcvdDate = dateString;
		return dateval;
	}
}

function update_time(dateString) {
	let time = "[" + dateString.slice(DATELEN + gWeekday[0].length, dateString.length);
	return time;
}

function doNotify(uid, channel, msgTimestamp, message) {
	gLastMessage[channel] = [msgTimestamp, uid, message];
	let msg = gLastMessage[channel];
	if (isCordova) {
		cordova.plugins.notification.local.schedule({
			title: msg[1],
			text: msg[2],
			icon: 'res://large_micon.png',
			smallIcon: 'res://icon.png',
			foreground: false,
			trigger: { in: 1, unit: 'second' }
		});
	}
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrollToBottomWithTimer() {
	await sleep(SCROLL_TIME);
	scrollToBottom();
	/* Scroll twice if me miss the first one in UI */
	await sleep(SCROLL_TIME);
	scrollToBottom();
}

async function resync(uid) {
	await sleep(RESYNC_TIMEOUT);
	queueSweepAndSend(uid);
}

async function reconnect(uid, channel) {
	if (gIsReconnect) {
		return;
	}

	if (gReconnTimeout > MAXTIMEOUT) {
		gReconnTimeout = MAXTIMEOUT;
		gReconnAttempts += 1;
	}

	gIsReconnect = true;
	await sleep(gReconnTimeout);
	gReconnTimeout *= 2;
	gWebWorker.postMessage(["reconnect", null, uid, channel, gIsTokenChannel]);
}

function syncReconnect() {
	if (gIsReconnect)
		return;

	if ('' != gMyName && '' != gMyChannel) {
		gWebWorker.postMessage(["reconnect", null, gMyName, gMyChannel, gIsTokenChannel]);
		sendInitJoin();
	}
}

function scrollToBottom() {
	messages_list.scrollTop = messages_list.scrollHeight;
}

function sendData(cmd, uid, channel, data, isFull, isImage, isMultipart, isFirst, isLast) {

	if (gInitOk) {
		let date = Date.now();
		let rarray = new Uint32Array(8);
		window.crypto.getRandomValues(rarray);
		let arr = [cmd, data, uid, channel, gIsTokenChannel, rarray, isFull, isImage, isMultipart, isFirst, isLast, date];

		if (data.length > 0) {
			gIdLastMsgHash[uid] = hash_message(uid, data);
		}
		gWebWorker.postMessage(arr);
		if (gSipKeyIsOk && isFull && data.length > 0)
			queuePostMsg(uid, [date, arr, hash_message(uid, data), isImage]);
	}
}

function updateAfterSend(message, isFull, isImage) {
	let dateString = "[" + timeNow() + "] ";
	let date = update_dateval(dateString);
	let time = update_time(dateString);
	let li;

	if (date) {
		/* Update new date header */
		li = '<li class="own"> - <span class="name">' + date + '</span> - </li>';
		$('#messages').append(li);
	}

	if (!isImage) {
		li = '<div id="owner' + gOwnId + '"><li class="own"> ' + time + "" + autolinker.link(message) + '</li></div>';
	}
	else {
		li = '<div id="owner' + gOwnId + '"><li class="own"> ' + time
			+ '<img class="image" src="' + message + '" height="100px" data-action="zoom" alt=""></li></div>';
	}

	if (isFull) {
		if (isImage) {
			$('#messages').append(li);
		}
		gLastWrittenMsg = li;
		gOwnId = gOwnId + 1;
		gOwnAppend = false;
	}
	else {
		gLastWrittenMsg = "";
		if (false == gOwnAppend) {
			$('#messages').append(li);
			gOwnAppend = true;
		}
		else
			$('#owner' + gOwnId).replaceWith(li);
	}
	scrollToBottom();
	if (isFull)
		$('#input_message').val('');
}

function sendMessage(message, isFull) {
	sendData("send", gMyName, gMyChannel, message, isFull, false, false, false);

	if (0 == message.length) {
		return;
	}

	updateAfterSend(message, isFull, false);

}

const MULTIPART_SLICE = 1024 * 8;
async function sendDataurl(dataUrl, uid, channel) {
	const isImage = true;
	const isFull = true;

	if (dataUrl.length > MULTIPART_SLICE) {
		let isMultipart = true;
		let isFirst;
		let isLast;
		gMultipartSendDict[uid + channel] = true;
		for (let i = 0; i < dataUrl.length; i += MULTIPART_SLICE) {
			isFirst = false;
			isLast = false;
			if (0 == i) {
				isFirst = true;
			}
			else if (i + MULTIPART_SLICE >= dataUrl.length) {
				isLast = true;
				let data = dataUrl.slice(i, dataUrl.length);
				sendData("send", gMyName, gMyChannel, data, isFull, isImage, isMultipart, isFirst, isLast);
				gMultipartSendDict[uid + channel] = false;
				multipartContinue = false;
				break;
			}
			let data = dataUrl.slice(i, i + MULTIPART_SLICE);
			sendData("send", gMyName, gMyChannel, data, isFull, isImage, isMultipart, isFirst, isLast);
			while (false == multipartContinue) {
				await sleep(ASYNC_SLEEP);
			}
			multipartContinue = false;
		}
	}
	else {
		sendData("send", gMyName, gMyChannel, data, isFull, isImage, false, false, false); /* is not multipart */
	}

	updateAfterSend(dataUrl, isFull, isImage);
}


function sendImage(file) {
	let fr = new FileReader();
	fr.onload = function (readerEvent) {
		if (file.size >= IMGFRAGSIZE) {
			let imgtype = 'image/jpeg';
			if (file.type.match('image/png')) {
				imgtype = 'image/png';
			}
			//resize the image
			let image = new Image();
			image.onload = function (imageEvent) {
				let canvas = document.createElement('canvas'),
					max_size = IMGMAXSIZE,
					width = image.width,
					height = image.height;
				if (width > height) {
					if (width > max_size) {
						height *= max_size / width;
						width = max_size;
					}
				} else {
					if (height > max_size) {
						width *= max_size / height;
						height = max_size;
					}
				}
				canvas.width = width;
				canvas.height = height;
				canvas.getContext('2d').drawImage(image, 0, 0, width, height);
				let dataUrl = canvas.toDataURL(imgtype);
				sendDataurl(dataUrl, gMyName, gMyChannel);
			}
			image.src = readerEvent.target.result;
		}
		else {
			//send directly without resize
			sendDataurl(fr.result, gMyName, gMyChannel);
		}
	}
	fr.readAsDataURL(file);
}

function getToken() {
	return "https://" + gAddrPortInput + "/mlestalk-web.html?token=" + token;
}

function getFront() {
	$("#channel_localization").val(getLocalLanguageSelection());
	setLanguage();
	$("#input_addr_port").val(getLocalAddrPortInput());
}

function getLocalAddrPortInput() {
	let apinput = window.localStorage.getItem('gAddrPortInput');
	if (apinput != undefined && apinput != '' && apinput != 'mles.io:80') {
		return apinput;
	}
	else {
		return "mles.io:443";
	}
}

function getLocalLanguageSelection() {
	let linput = window.localStorage.getItem('localization');
	if (linput != undefined && linput != '') {
		return linput;
	}
	else {
		return "gb";
	}
}

/* Language specific functions -- start -- */
function setLanguage() {
	let language = $("#channel_localization").val();

	switch (language) {
		case "fi":
			$("#channel_user_name").text("Nimesi?");
			$("#channel_name").text("Kanava?");
			$("#channel_key").text("Jaettu avain?");
			$("#channel_server").text("Mles WebSocket palvelimen osoite");
			$("#channel_exit").val("poistu");
			$("#app_info").text("lisätietoja sovelluksesta");
			$("#legal").text("lakitiedot");
			gWeekday[0] = "su";
			gWeekday[1] = "ma";
			gWeekday[2] = "ti";
			gWeekday[3] = "ke";
			gWeekday[4] = "to";
			gWeekday[5] = "pe";
			gWeekday[6] = "la";
			gBgTitle = "MlesTalk taustalla";
			gBgText = "Ilmoitukset aktiivisena";
			gImageStr = "<kuva>";
			break;
		case "se":
			$("#channel_user_name").text("Ditt namn?");
			$("#channel_name").text("Kanal?");
			$("#channel_key").text("Delad nyckel?");
			$("#channel_server").text("Mles WebSocket server adress");
			$("#channel_exit").val("utgång");
			$("#app_info").text("appinfo");
			$("#legal").text("rättslig");
			gWeekday[0] = "sö";
			gWeekday[1] = "må";
			gWeekday[2] = "ti";
			gWeekday[3] = "on";
			gWeekday[4] = "to";
			gWeekday[5] = "fr";
			gWeekday[6] = "lö";
			gBgTitle = "MlesTalk i bakgrunden";
			gBgText = "Meddelanden aktiva";
			gImageStr = "<en bild>";
			break;
		case "es":
			$("#channel_user_name").text("Su nombre?");
			$("#channel_name").text("Canal?");
			$("#channel_key").text("Llave compartida?");
			$("#channel_server").text("Mles WebSocket dirección del servidor");
			$("#channel_exit").val("salida");
			$("#app_info").text("info de la app");
			$("#legal").text("legal");
			gWeekday[0] = "D";
			gWeekday[1] = "L";
			gWeekday[2] = "M";
			gWeekday[3] = "X";
			gWeekday[4] = "J";
			gWeekday[5] = "V";
			gWeekday[6] = "S";
			gBgTitle = "MlesTalk en el fondo";
			gBgText = "Notificaciones activas";
			gImageStr = "<una imagen>";
			break;
		case "de":
			$("#channel_user_name").text("Dein name?");
			$("#channel_name").text("Kanal?");
			$("#channel_key").text("Gemeinsamer Schlüssel?");
			$("#channel_server").text("Mles WebSocket Serveradresse");
			$("#channel_exit").val("abgehen");
			$("#app_info").text("app info");
			$("#legal").text("legal");
			gWeekday[0] = "So";
			gWeekday[1] = "Mo";
			gWeekday[2] = "Di";
			gWeekday[3] = "Mi";
			gWeekday[4] = "Do";
			gWeekday[5] = "Fr";
			gWeekday[6] = "Sa";
			gBgTitle = "MlesTalk im Hintergrund";
			gBgText = "Benachrichtigungen aktiv";
			gImageStr = "<ein Bild>";
			break;
		case "fr":
			$("#channel_user_name").text("Votre nom?");
			$("#channel_name").text("Canal?");
			$("#channel_key").text("Clé partagée?");
			$("#channel_server").text("Mles WebSocket adresse du serveur");
			$("#channel_exit").val("sortie");
			$("#app_info").text("info sur l'app");
			$("#legal").text("légal");
			gWeekday[0] = "dim";
			gWeekday[1] = "lun";
			gWeekday[2] = "mar";
			gWeekday[3] = "mer";
			gWeekday[4] = "jeu";
			gWeekday[5] = "ven";
			gWeekday[6] = "sam";
			gBgTitle = "MlesTalk en arrière-plan";
			gBgText = "Notifications actives";
			gImageStr = "<une image>";
			break;
		case "gb":
		default:
			$("#channel_user_name").text("Your name?");
			$("#channel_name").text("Channel?");
			$("#channel_key").text("Shared key?");
			$("#channel_server").text("Mles WebSocket server address");
			$("#channel_exit").val("exit");
			$("#app_info").text("app info");
			$("#legal").text("legal");
			gWeekday[0] = "Sun";
			gWeekday[1] = "Mon";
			gWeekday[2] = "Tue";
			gWeekday[3] = "Wed";
			gWeekday[4] = "Thu";
			gWeekday[5] = "Fri";
			gWeekday[6] = "Sat";
			gBgTitle = "MlesTalk in the background";
			gBgText = "Notifications active";
			gImageStr = "<an image>";
			break;
	}

	if (isCordova) {
		cordova.plugins.backgroundMode.setDefaults({
			title: gBgTitle,
			text: gBgText
		});
	}
}

function popAlert() {
	let language = $("#channel_localization").val();
	switch (language) {
		case "fi":
			alert('Nimi, kanava ja jaettu avain?');
			break;
		case "se":
			alert('Namn, kanal och delad nyckel?');
			break;
		case "es":
			alert('Nombre, canal y clave compartida?');
			break;
		case "de":
			alert('Name, Kanal und gemeinsamer Schlüssel?');
			break;
		case "fr":
			alert('Nom, canal et clé partagée?');
			break;
		case "gb":
		default:
			alert('Name, channel and shared key?');
			break;
	}
}

/* Language specific functions -- end -- */

/* Unit tests */
function runUnitTests() {
	//initTests();
	//timestampTest();
	//deinitTests();
}

function initTests() {
	gInitOk = true;
	gMyName = "unittest";
	gMyChannel = "unittest";
	gSipKey = SipHash.string16_to_key(atob(gMyChannel));
	gSipKeyIsOk = true;
}

function deinitTests() {
	gInitOk = false;
	gMyName = undefined;
	gMyChannel = undefined;
	gSipKey = undefined;
	gSipKeyIsOk = false;
}

function timestampTest() {
	let time = Date.now();
	/* Receive message with time */
	let ret = processData("tester", "unittest", time, "First test message", true, false, false, false, false);
	if (ret != 1)
		console.log("First message failed! " + ret);

	/* Receive presence message with time + 1 */
	ret = processData("tester", "unittest", time + 1, "", false, false, false, false, false);
	if (ret != 1)
		console.log("Presence message failed! " + ret)

	ret = processData("tester", "unittest", time, "First test message", false, false, false, false, false);
	if (ret != 0)
		console.log("Resend message failed! " + ret)

	ret = processData("tester", "unittest", time, "First test message", true, false, false, false, false);
	if (ret != 0)
		console.log("Resend full message failed! " + ret)
	/* => Check that it is not shown */
}


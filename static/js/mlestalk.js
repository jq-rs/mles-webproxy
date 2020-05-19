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
let gPresenceTs = {};
let gIdNotifyTs = {};
let gIdLastMsgHash = {};
let gIdLastMsgLen = {};
let gIdReconnSync = {};

/* Msg type flags */
const MSGISFULL =       0x1;
const MSGISPRESENCE =  (0x1 << 1);
const MSGISIMAGE =     (0x1 << 2);
const MSGISMULTIPART = (0x1 << 3);
const MSGISFIRST =     (0x1 << 4);
const MSGISLAST =      (0x1 << 5);

let gUidQueue = {};

const IMGMAXSIZE = 960; /* px */
const IMGFRAGSIZE = 512 * 1024;

let gInitOk = false;
const PRESENCETIME = 181 * 1000; /* ms */
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

function hashMessage(uid, data) {
	return SipHash.hash_hex(gSipKey, uid + data);
}

function uidQueueGet(uid, channel) {
	return gUidQueue[get_uniq(uid, channel)];
}

function queueFindAndMatch(msgTimestamp, uid, channel, message) {
	let q = uidQueueGet(uid, channel);
	if (q) {
		let lastSeen = -1;
		for (let i = 0; i < q.getLength(); i++) {
			let obj = q.get(i);
			if (obj[0] < msgTimestamp) {
				lastSeen = i + 1;
				continue;
			}
			if(message.length > 0) {
				let hash = hashMessage(uid, message);
				if (obj[2] == hash) {
					lastSeen = i + 1;
					break;
				}
			}
		}
		if (lastSeen != -1) {
			q.flush(lastSeen);
		}
	}
}

function queueSweepAndSend(uid, channel) {
	let q = uidQueueGet(uid, channel);
	let cnt = 0;
	if (q) {
		for (let i = 0; i < q.getLength(); i++) {
			let obj = q.get(i);
			let tmp = obj[1];
			if (tmp[2] == uid) {
				gWebWorker.postMessage(tmp);
				cnt++;
				gIdLastMsgHash[tmp[2]] = hashMessage(tmp[2], tmp[1]);
			}
		}
		for (let userid in gIdReconnSync) {
			gIdReconnSync[userid] = false;
		}
	}
	gIsResync = false;
	console.log("Resync complete: swept " + cnt + " msgs.");
}

function uidQueuePush(uid, channel, arr) {
	let q = uidQueueGet(uid, channel);
	if (!q) {
		gUidQueue[get_uniq(uid, channel)] = new Queue();
		q = uidQueueGet(uid, channel);
	}
	q.push(arr);
}

function queuePostMsg(uid, channel, arr) {
	uidQueuePush(uid, channel, arr);
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

function get_uniq(uid, channel) {
	return uid + "|" + channel;
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

let gIsPresenceView = false;
function onBackKeyDown() {
	if(!gInitOk)
		return;
	/* Open presence info */
	if(!gIsPresenceView) {
		presenceShow();
		gIsPresenceView = true;
	}
	else {
		presenceExit();
		gIsPresenceView = false;
	}
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

/* Presence */
function sendEmptyJoin() { 
	sendMessage("", false, true);
}

/* Join after disconnect */
function sendInitJoin() {
	sendMessage("", true, false);
}

function send(isFull) {
	let message = $('#input_message').val();
	let file = document.getElementById("input_file").files[0];

	if (file) {
		sendImage(file);
		document.getElementById("input_file").value = "";
	}
	else {
		sendMessage(message, isFull, false);
		updateAfterSend(message, isFull, false);
	}
}

function chanExit() {
	closeSocket();
}

function presenceShow() {
	let date = Date.now();

	for (let userid in gPresenceTs) {
		let userpres = userid.split('|');
		if(userpres[0] == gMyName)
			continue;
		console.log("Timestamp" + gPresenceTs[userid].valueOf() + " Saved timestamp " + date.valueOf())
		if(gPresenceTs[userid].valueOf() + PRESENCETIME >= date.valueOf())
			li = '<li class="new"><span class="name">' + userpres[0] + "@" + userpres[1] + '</span> <img src="img/available.png" alt="green" style="vertical-align:middle;height:22px;" /></li>';
		else
			li = '<li class="new"><span class="name">' + userpres[0] + "@" + userpres[1] + '</span> <img src="img/unavailable.png" alt="grey" style="vertical-align:middle;height:22px;" /></li>';
		$('#presence_avail').append(li);
	}
	$('#message_cont').fadeOut(400, function () {
		$('#presence_cont').fadeIn();
	});
}

function presenceExit() {
	$('#presence_cont').fadeOut(400, function () {
		$('#message_cont').fadeIn();
	});
	$('#presence_avail').html('');
}

function closeSocket() {
	initReconnect();
	gInitOk = false;

	//init all databases
	for (let userid in gIdTimestamp) {
		gIdTimestamp[userid] = 0;
	}
	for (let userid in gPresenceTs) {
		gPresenceTs[userid] = 0;
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

	queueSweepAndSend(gMyName, gMyChannel);

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
	$('#presence_cont').fadeOut();
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

function get_duid(uid, channel) {
	return uid.split(' ').join('_') + channel.split(' ').join('_');
}

function processData(uid, channel, msgTimestamp,
	message, isFull, isPresence, isImage,
	isMultipart, isFirst, isLast)
{
	//update hash
	let duid = get_duid(uid, channel);
	if (gIdHash[duid] == null) {
		gIdHash[duid] = 0;
		gIdAppend[duid] = false;
		gIdTimestamp[get_uniq(uid, channel)] = msgTimestamp;
		gPresenceTs[get_uniq(uid, channel)] = msgTimestamp;
		gIdNotifyTs[get_uniq(uid, channel)] = 0;
		gIdLastMsgHash[get_uniq(uid, channel)] = 0;
		gIdReconnSync[get_uniq(uid, channel)] = false;
	}

	let dateString = "[" + stampTime(new Date(msgTimestamp)) + "] ";

	//begin presence time per user (now)

	if (uid == gMyName) {
		if (!gIsResync) {
			console.log("Resyncing");
			gIsResync = true;
			resync(uid, channel);
		}
		if ((isFull && message.length > 0) || (!isFull && message.length == 0)) /* Full or presence message */
			queueFindAndMatch(msgTimestamp, uid, channel, message);
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
		if (!gMultipartDict[get_uniq(uid, channel)]) {
			if (!isFirst) {
				//invalid frame
				return 0;
			}
			gMultipartDict[get_uniq(uid, channel)] = "";
		}
		gMultipartDict[get_uniq(uid, channel)] += message;
		if (!isLast) {
			return 0;
		}
		message = gMultipartDict[get_uniq(uid, channel)];
		gMultipartDict[get_uniq(uid, channel)] = null;
	}

	if (gIdTimestamp[get_uniq(uid, channel)] <= msgTimestamp) {
		let date;
		let time;
		let li;

		gPresenceTs[get_uniq(uid, channel)] = msgTimestamp;

		if (isFull && 0 == message.length) /* Ignore init messages in timestamp processing */
			return 0;

		if (!gIdReconnSync[get_uniq(uid, channel)]) {
			gIdLastMsgHash[get_uniq(uid, channel)] = hashMessage(uid, isFull ? msgTimestamp + message + '\n' : msgTimestamp + message);
		}
		else if (msgTimestamp >= gIdTimestamp[get_uniq(uid, channel)]) {
			let mHash = hashMessage(uid, isFull ? msgTimestamp + message + '\n' : msgTimestamp + message);
			if (mHash == gIdLastMsgHash[get_uniq(uid, channel)]) {
				gIdReconnSync[get_uniq(uid, channel)] = false;
				gIdTimestamp[get_uniq(uid, channel)] = msgTimestamp;
			}
			return 0;
		}
		
		gIdTimestamp[get_uniq(uid, channel)] = msgTimestamp;
		if (gLastMessageSeenTs < msgTimestamp)
			gLastMessageSeenTs = msgTimestamp;

		if (isPresence)
			return 1;

		date = updateDateval(dateString);
		if (date) {
			/* Update new date header */
			li = '<li class="new"> - <span class="name">' + date + '</span> - </li>';
			$('#messages').append(li);
		}
		time = updateTime(dateString);

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

		if (uid != gMyName && isFull && gIdNotifyTs[get_uniq(uid, channel)] < msgTimestamp) {
			if (gWillNotify && gCanNotify) {
				if (true == isImage) {
					message = gImageStr;
				}
				doNotify(uid, channel, msgTimestamp, message);
			}
			gIdNotifyTs[get_uniq(uid, channel)] = msgTimestamp;
		}
	}
	return 0;
}

function processSend(uid, channel, isMultipart) {
	if (isMultipart) {
		if (gMultipartSendDict[get_uniq(uid, channel)]) {
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
				let msgtype = e.data[5];

				initReconnect();

				let ret = processData(uid, channel, msgTimestamp,
					message, msgtype & MSGISFULL ? true : false, msgtype & MSGISPRESENCE ? true : false, msgtype & MSGISIMAGE ? true : false,
					msgtype & MSGISMULTIPART ? true : false, msgtype & MSGISFIRST ? true : false, msgtype & MSGISLAST ? true : false);
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

function updateDateval(dateString) {
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

function updateTime(dateString) {
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

async function resync(uid, channel) {
	await sleep(RESYNC_TIMEOUT);
	queueSweepAndSend(uid, channel);
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
		sendEmptyJoin();
	}
}

function scrollToBottom() {
	messages_list.scrollTop = messages_list.scrollHeight;
}

function sendData(cmd, uid, channel, data, msgtype) {
	if (gInitOk) {
		let date = Date.now();
		let rarray = new Uint32Array(8);
		window.crypto.getRandomValues(rarray);
		let arr = [cmd, data, uid, channel, gIsTokenChannel, rarray, msgtype, date];

		if (!gIsResync || data.length == 0) {
			if (data.length > 0) {
				gIdLastMsgHash[get_uniq(uid, channel)] = hashMessage(uid, data);
			}
			gWebWorker.postMessage(arr);
		}
		if (gSipKeyIsOk && msgtype & MSGISFULL && data.length > 0)
			queuePostMsg(uid, channel, [date, arr, hashMessage(uid, data), msgtype & MSGISIMAGE ? true : false]);
	}
}

function updateAfterSend(message, isFull, isImage) {
	let dateString = "[" + timeNow() + "] ";
	let date = updateDateval(dateString);
	let time = updateTime(dateString);
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

function sendMessage(message, isFull, isPresence) {
	let msgtype = (isFull ? MSGISFULL : 0);
	msgtype |= (isPresence ? MSGISPRESENCE : 0)
	sendData("send", gMyName, gMyChannel, message, msgtype);
}

const MULTIPART_SLICE = 1024 * 8;
async function sendDataurl(dataUrl, uid, channel) {
	let msgtype = MSGISFULL|MSGISIMAGE;

	if (dataUrl.length > MULTIPART_SLICE) {
		msgtype |= MSGISMULTIPART;
		gMultipartSendDict[get_uniq(uid, channel)] = true;
		for (let i = 0; i < dataUrl.length; i += MULTIPART_SLICE) {
			if (0 == i) {
				msgtype |= MSGISFIRST;
			}
			else if (i + MULTIPART_SLICE >= dataUrl.length) {
				msgtype |= MSGISLAST;
				let data = dataUrl.slice(i, dataUrl.length);
				sendData("send", gMyName, gMyChannel, data, msgtype);
				gMultipartSendDict[get_uniq(uid, channel)] = false;
				multipartContinue = false;
				break;
			}
			let data = dataUrl.slice(i, i + MULTIPART_SLICE);
			sendData("send", gMyName, gMyChannel, data, msgtype);
			while (false == multipartContinue) {
				await sleep(ASYNC_SLEEP);
			}
			multipartContinue = false;
		}
	}
	else {
		sendData("send", gMyName, gMyChannel, data, msgtype); /* is not multipart */
	}

	updateAfterSend(dataUrl, true, true);
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


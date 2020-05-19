/* Language specific functions -- start -- */
function getLocalLanguageSelection() {
	let linput = window.localStorage.getItem('localization');
	if (linput != undefined && linput != '') {
		return linput;
	}
	else {
		return "gb";
	}
}

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
			$("#channel_user_name").text("¿Su nombre?");
			$("#channel_name").text("¿Canal?");
			$("#channel_key").text("¿Llave compartida?");
			$("#channel_server").text("Dirección del servidor Mles Websocket");
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
		case "pt":
			$("#channel_user_name").text("Seu nome?");
			$("#channel_name").text("Canal?");
			$("#channel_key").text("Chave compartilhada?");
			$("#channel_server").text("Endereço do servidor Mles Websocket");
			$("#channel_exit").val("saída");
			$("#app_info").text("informação da aplicação");
			$("#legal").text("legal");
			gWeekday[0] = "Dom.";
			gWeekday[1] = "Seg.";
			gWeekday[2] = "Ter.";
			gWeekday[3] = "Qua.";
			gWeekday[4] = "Qui.";
			gWeekday[5] = "Sex.";
			gWeekday[6] = "Sáb.";
			gBgTitle = "MlesTalk correndo em segundo plano";
			gBgText = "Notificações ativas";
			gImageStr = "<uma imagem>";
			break;
		case "ru":
			$("#channel_user_name").text("Твое имя?");
			$("#channel_name").text("Канал?");
			$("#channel_key").text("Общий ключ?");
			$("#channel_server").text("Адрес сервера Mles Websocket");
			$("#channel_exit").val("выход");
			$("#app_info").text("информация о приложении");
			$("#legal").text("правовой");
			gWeekday[0] = "ВСК";
			gWeekday[1] = "ПНД";
			gWeekday[2] = "ВТР";
			gWeekday[3] = "СРД";
			gWeekday[4] = "ЧТВ";
			gWeekday[5] = "ПТН";
			gWeekday[6] = "СБТ";
			gBgTitle = "MlesTalk в фоновом режиме";
			gBgText = "Уведомления активны";
			gImageStr = "<изображение>";
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
        case "pt":
            alert('Seu nome, canal e chave compartilhada?');
            break;
        case "ru":
            alert('Твое имя, канал и общий ключ?');
            break;
        case "gb":
		default:
			alert('Name, channel and shared key?');
			break;
	}
}

/* Language specific functions -- end -- */

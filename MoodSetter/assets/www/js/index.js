/*
    CURRENT STATUS:
        can pick songs
        can set lights
        can write current settings to tag
        can red current settings from tag

    TODO:
        clean up errors
        Simplify or remove authorization methods (Don?)
*/


var app = {
    // parameters for tag reading/writing:
    mode: "write",

    // parameters for hue:
    hueDeviceType: "NFC Switch",        // The App name
    hueUserName: "thomaspatrickigoe",   // fill in your Hue user name here
    hueAddress: null,                   // the IP address of your Hue
    lightId: 1,                         // which light you are changing
    mimeType: 'text/hue',               // the NFC record MIME Type
    lights: {},                         // names and states of the lights

    // parameters for audio playback:
    // The path to the folder where you keep all your music:
    musicPath: "file:///storage/emulated/0/Download/",
    currentSong: null,      // media handle for the current song playing
    songTitle: null,        // title of the song
    musicState: 0,          // state of the song: playing stopped, etc.

/*
    Application constructor
*/
    initialize: function() {
        this.bindEvents();
        console.log("Starting Mood Setter app");
    },

    // bind any events that are required on startup to listeners:
    bindEvents: function() {
        document.addEventListener('deviceready', this.onDeviceReady, false);

        // hue faders from the UI: brightness, hue, saturation:
        bri.addEventListener('touchend', app.setBrightness, false);
        hue.addEventListener('touchend', app.setHue, false);
        sat.addEventListener('touchend', app.setSaturation, false);

        // buttons from the UI:
        modeButton.addEventListener('touchStart', app.setMode, false);
        tagWriterButton.addEventListener('touchstart', app.makeMessage, false);

        // pause and resume functionality for the whole app:
        document.addEventListener('pause', this.onPause, false);
        document.addEventListener('resume', this.onResume, false);
    },
/*
    this runs when the device is ready for user interaction:
*/
    onDeviceReady: function() {
        app.setSong();      // initialize the music
        app.clear();        // clear any messages onscreen

        // get the Hue's address
        app.findControllerAddress();    // find address and get settings
        app.setMode();              // set the read/write mode for tags

        app.display("Tap a tag to play its song and set the lights.");

        nfc.addNdefFormatableListener(
            app.onNfc,                                  // tag successfully scanned
            function (status) {                         // listener successfully initialized
                app.display("Listening for NDEF-formatable tags.");
            },
            function (error) {                          // listener fails to initialize
                app.display("NFC reader failed to initialize " + JSON.stringify(error));
            }
        );

        nfc.addMimeTypeListener(
            app.mimeType,
            app.onNfc,
            function() { console.log("listening for mime media tags"); },
            function(error) { console.log("ERROR: " + JSON.stringify(error)); }
        );
    },

/*
    This is called when the app is paused
*/
    onPause: function() {
        app.pauseAudio();
    },

/*
    This is called when the app is resumed
*/
    onResume: function() {
        app.startAudio();
    },

    /*
        Set the tag read/write mode for the app:
    */
    setMode: function() {
        console.log("Switching modes");
        if (app.mode === "write") {     // change to read
            // hide the write button
            tagWriterButton.style.visibility = "hidden";
            app.mode = "read";
        } else {                        // change to write
            // show the write button
            tagWriterButton.style.visibility = "visible";
            app.mode = "write";
        }
        modeValue.innerHTML = app.mode; // set text in the UI
    },
/*
    runs when an NDEF-formatted tag shows up.
*/
    onNfc: function(nfcEvent) {
        var tag = nfcEvent.tag;

        if (app.mode === "read") {
            app.readTag(tag);
        } else {
            app.makeMessage();
        }
    },

    readTag: function(thisTag) {
        var message = thisTag.ndefMessage,
            record,
            recordType,
            content;

        console.log("record count: " + message.length);

        for (var thisRecord in message) {
            // get the next record in the message array:
            record = message[thisRecord];
            // parse the record:
            recordType = nfc.bytesToString(record.type);
            console.log("Record type: " + recordType);
            // if you've got a URI, use it to start a song:
            if (recordType === nfc.bytesToString(ndef.RTD_URI)) {
                // for some reason I have to cut the first byte of the payload
                // in order to get a playable URI:
                var trash = record.payload.shift();
                console.log("got a new song " + record.payload);
                // convert the remainder of the payload to a string:
                content = nfc.bytesToString(record.payload);
                app.stopAudio();      // stop whatever is playing
                app.setSong(content); // set the song name
                app.startAudio();     // play the song
            }

            // if you've got a hue JSON object, set the lights:
            if (recordType === 'text/hue') {
                // tag should be TNF_MIME_MEDIA with a type 'text/hue'
                // assume we get a JSON object as the payload
                // JSON object should have valid settings info for the hue
                // http://developers.meethue.com/1_lightsapi.html
                // { "on": true }
                // { "on": false }

                content = nfc.bytesToString(record.payload);
                console.log("got some new lights: " + content);
                content = JSON.parse(content); // don't really need to parse
                app.setAllLights(content);
                console.log(content);
                console.log("Set the lights");
            }
        }
    },

    setAllLights: function(settings) {
        for (thisLight in settings) {
            // set name
            app.hue(settings[thisLight].name, "name");
            // set state
            app.hue(settings[thisLight].state, "state");
        }
    },

    hue: function(settings, property) {
        // if they just send settings, assume they are the light state:
        if (!property) {
            property = "state";
        }

        // set the property for the light:
        $.ajax({
            type: 'PUT',
            url: 'http://' + app.hueAddress + '/api/' + app.hueUserName + '/lights/' + app.lightId + '/' + property,
            data: JSON.stringify(settings),
            success: function(data){
                console.log(JSON.stringify(data));
                if (data[0].error) {
                    navigator.notification.alert(JSON.stringify(data), null, "API Error");
                }
            },
            error: function(xhr, type){
                navigator.notification.alert(xhr.responseText + " (" + xhr.status + ")", null, "Error");
            }
        });

    },

    /*
        Set the value of the UI controls using the values from the Hue:
    */
    setControls: function() {
        app.lightId = lightNumber.value;
        hue.value = app.lights[app.lightId].state.hue;
        bri.value = app.lights[app.lightId].state.bri;
        sat.value = app.lights[app.lightId].state.sat;
        lightOn.checked = app.lights[app.lightId].state.on;

        // set the names of the lights in the dropdown menu:
        // TODO: Generalize this for more than three lights:
        lightNumber.options[0].innerHTML = app.lights["1"].name;
        lightNumber.options[1].innerHTML = app.lights["2"].name;
        lightNumber.options[2].innerHTML = app.lights["3"].name;
    },

    /*
        These functions set the properties for a Hue light:
        Brightness, Hue, Saturation, and On State
    */
    setBrightness: function() {
        var brightnessValue = parseInt(bri.value);
        app.hue( { "bri": brightnessValue } );
    },

    setHue: function() {
        var hueValue = parseInt(hue.value);
        app.hue( { "hue": hueValue } );
    },

    setSaturation: function() {
        var saturationValue = parseInt(sat.value);
        app.hue( { "sat": saturationValue } );
    },

    setLightOn: function() {
        var onValue = lightOn.checked;
        app.hue( { "on": onValue } );
    },

    /*
        Get the settings from the Hue and store a subset of them locally
        in app.lights.  This is for both setting the controls, and so you
        have an object to write to a tag:
    */
    getHueSettings: function() {
        // query the hub and get its current settings:
        var url = 'http://' + app.hueAddress + '/api/' + app.hueUserName;

        $.get(url, function(data) {
            // the full settings take more than you want to
            // fit on a tag, so just get the settings you want:
            for (thisLight in data.lights) {
                app.lights[thisLight] = {};
                app.lights[thisLight]["name"] = data.lights[thisLight].name;
                app.lights[thisLight]["state"] = {};
                app.lights[thisLight].state.on = data.lights[thisLight].state.on;
                app.lights[thisLight].state.bri = data.lights[thisLight].state.bri;
                app.lights[thisLight].state.hue = data.lights[thisLight].state.hue;
                app.lights[thisLight].state.sat = data.lights[thisLight].state.sat;
            }
            app.setControls();
        });
    },

    /*
        Find the Hue controller address and get its settings
    */

    findControllerAddress: function() {
        $.ajax({
            url: 'http://www.meethue.com/api/nupnp',
            dataType: 'json',
            success: function(data) {
                // expecting a list
                if (data[0]) {
                    app.hueAddress = data[0].internalipaddress;
                    app.getHueSettings();   // copy the Hue settings locally
                }
            },
            error: function(xhr, type){
                console.log("Find Controller Address error, couldn't get address");
                navigator.notification.alert(xhr.responseText + " (" + xhr.status + ")", null, "Error");
            }
        });
    },

    ensureAuthorized: function() {
        var message;

        $.ajax({
            type: 'GET',
            url: 'http://' + app.hueAddress + '/api/' + app.hueUserName,
            success: function(data){
                if (data[0].error) {
                    // if not authorized, users gets an alert box
                    if (data[0].error.type === 1) {
                        message = "Press link button on the hub.";
                    } else {
                        message = data[0].error.description;
                    }
                    navigator.notification.alert(message, app.authorize, "Not Authorized");
                }
            },
            error: function(xhr, type){
                navigator.notification.alert(xhr.responseText + " (" + xhr.status + ")", null, "Error");
            }
        });
    },

    authorize: function() { // could probably be combined with ensureAuthorized

        var data = { "devicetype": app.hueDeviceType, "username": app.hueUserName },
            message;

        $.ajax({
            type: 'POST',
            url: 'http://' + app.hueAddress + '/api',
            data: JSON.stringify(data),
            success: function(data){
                if (data[0].error) {
                    // if not authorized, users gets an alert box
                    if (data[0].error.type === 101) {
                        message = "Press link button on the hub.";
                    } else {
                        message = data[0].error.description;
                    }
                    navigator.notification.alert(message, app.authorize, "Not Authorized");
                }
            },
            error: function(xhr, type){
                navigator.notification.alert(xhr.responseText + " (" + xhr.status + ")", null, "Error");
            }
        });
    },

    setSong: function(content) {
        app.audioStatus();

        console.log("setting song");

        if (app.currentSong) {
            app.stopAudio();            // stop whatever song is playing
            app.currentSong = null;     // clear the media object
        }

        if (content) {
            app.songTitle = content;
        } else if (songName.files[0] !== undefined ) {
            app.songTitle = songName.files[0].name;
        }
         console.log("Song Title: " + app.songTitle);
    },

    // song audio
    startAudio: function() {
        console.log("StartAudio: " + app.musicState);
       // attempt to instantiate a song:
        if (app.currentSong === null) {
            // Create Media object from songTitle
            if (app.songTitle) {
                songPath = app.musicPath + app.songTitle;
                console.log("Attempting to play " + app.songTitle);
                app.currentSong = new Media(songPath, app.onSuccess, app.onError, app.audioStatus);
            } else {
                console.log("Pick a song!")
            }
        }

        switch(app.musicState) {
            case undefined:
            case Media.MEDIA_NONE:
                app.playAudio();
                break;
            case Media.MEDIA_RUNNING:
                app.pauseAudio();
                break;
            case Media.MEDIA_PAUSED:
                app.playAudio();
                console.log("music paused");
                break;
            case Media.MEDIA_STOPPED:
                app.playAudio();
                break;
        }
    },

    playAudio: function() {
        if (app.currentSong) {
            app.currentSong.play();
            app.clear();
            app.display("Song: " + app.songTitle);
            playButton.innerHTML = "Pause";
        }
    },

    pauseAudio: function() {
        if (app.currentSong) {
            app.currentSong.pause();
            playButton.innerHTML = "Play";
        }
    },

    stopAudio: function() {
        if (app.currentSong) {
            app.currentSong.stop();
            playButton.innerHTML = "Play";
        }
    },

    audioStatus: function(status) {
       var state;
       app.musicState = status;

        switch(status) {
            case Media.MEDIA_NONE:
                state = "none";
                break;
            case Media.MEDIA_STARTING:
                state = "music starting";
                break;
            case Media.MEDIA_RUNNING:
                state = "music running";
                break;
            case Media.MEDIA_PAUSED:
                state = "music paused";
                break;
            case Media.MEDIA_STOPPED:
                state = "music stopped";
                break;
        }
        console.log("Music state: " + state);
    },

    onSuccess: function() {
        console.log("starting audio");
    },

    // onError Callback
    //
    onError: function(error) {
        alert('code: '    + error.code    + '\n' +
              'message: ' + error.message + '\n');
    },

/*
    appends @message to the message div:
*/
    display: function(message) {
        var display = document.getElementById("message"),   // the div you'll write to
            label,                                          // what you'll write to the div
            lineBreak = document.createElement("br");       // a line break

        label = document.createTextNode(message);           // create the label
        display.appendChild(lineBreak);                     // add a line break
        display.appendChild(label);                         // add the message node
    },
/*
    clears the message div:
*/
    clear: function() {
        var display = document.getElementById("message");
        display.innerHTML = "";
    },

/*
    makes an NDEF message and calls writeTag() to write it to a tag:
*/
    makeMessage: function() {
        var message = [];

        // get the current state of the lights:
        console.log(JSON.stringify(app.lights));
        var lightRecord = ndef.mimeMediaRecord(app.mimeType, JSON.stringify(app.lights)),
            songRecord = ndef.uriRecord(app.songTitle);

        // put the record in the message array:
        message.push(lightRecord);
        message.push(songRecord);

        //write the message:
        app.writeTag(message);
    },

/*
    writes NDEF message @message to a tag:
*/
    writeTag: function(message) {
        // write the record to the tag:
        nfc.write(
            message,						// write the record itself to the tag
            function () {					// when complete, run this callback function:
                app.clear();                            // clear the message div
                app.display("Wrote data to tag.");		// notify the user in message div
                navigator.notification.vibrate(100);	// vibrate the device as well
            },
            function (reason) {				// this function runs if the write command fails
                navigator.notification.alert(reason, function() {}, "There was a problem");
            }
        );
    }
};          // end of app
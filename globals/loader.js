/*
 * Copyright 2000-2020 Sergei Sovik <sergeisovik@yahoo.com>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *		http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

import { getTickCounter } from "./../../../include/time.js"
import { unbindEvent, bindEvent } from "./../../../include/event.js"
import { URI } from "./../../../include/uri.js"
import { VOLUME_MIN } from "./../../js-mixer/modules/sound.js"
import { HSIA2RGBA, MorphRGBA, RGBA2STR } from "./../../js-color/modules/color.js"
import { MessagePool } from "./../../js-message/globals/message.js"
import { Gallery } from "./../../js-gallery/globals/gallery.js"
import { Mixer } from "./../../js-mixer/globals/mixer.js"
import { TextureImpl } from "./../../../include/texture.js"

export const evLoaderStart = 'evLoaderStart';
export const evLoaderStop = 'evLoaderStop';
export const evLoaderStatus = 'evLoaderStatus';
export const evLoaderFile = 'evLoaderFile';
export const evLoaderError = 'evLoaderError';
export const evLoaderComplete = 'evLoaderComplete';
export const evLoaderTerminate = 'evLoaderTerminate';
export const evUserInteraction = 'evUserInteraction';

const sLoadingTexture = 'loader#loading';
const sPressAnyKey = 'Press Any Key';
const uMaxParallelJobs = 10;

/** @enum {string} */
const LoaderSupportedType = {
    IMAGE: "image",
    SOUND: "sound",
    JSON: "json",
    TEXT: "text",
    DATA: "data",
};

/** @typedef {Object<string, Array<string>>} LoaderSupportedTypes */
var LoaderSupportedTypes;

/** @type {LoaderSupportedTypes} */
const supportedTypes = {
    [LoaderSupportedType.IMAGE]: [".png", ".jpg", ".jpeg", ".gif", ".svg"],
    [LoaderSupportedType.SOUND]: [".mp3", ".ogg", ".snd"],
    [LoaderSupportedType.JSON]: [".json"],
    [LoaderSupportedType.TEXT]: [".txt"],
};

/** @enum {string} */
const LoaderResponseType = {
    BLOB: "arraybuffer",
    TEXT: "text",
    JSON: "json",
};

/** @typedef {Object<string, Array<string>>} LoaderResponseTypes */
var LoaderResponseTypes;

/** @type {LoaderResponseTypes} */
const responseTypes = {
    [LoaderResponseType.BLOB]: [".bin"],
    [LoaderResponseType.TEXT]: [".txt"],
    [LoaderResponseType.JSON]: [".json"],
};

/** @typedef {{
	uTotal: number,
	uComplete: number,
	uError: number
}} LoaderStatus */
var LoaderStatus;

/**
 * @param {string} sEXT
 * @returns {LoaderSupportedType}
 */
function typeOf(sEXT) {
    for (var i in supportedTypes) {
        if (supportedTypes[i].indexOf(sEXT) != -1)
            return /** @type {LoaderSupportedType} */ (i);
    }
    return LoaderSupportedType.DATA;
}

/**
 * @param {string} sEXT 
 * @returns {LoaderResponseType}
 */
function responseTypeOf(sEXT) {
    for (var i in responseTypes) {
        if (responseTypes[i].indexOf(sEXT) != -1)
            return /** @type {LoaderResponseType} */ (i);
    }
    return LoaderResponseType.TEXT;
}

/**
 * @extends {XMLHttpRequest}
 */
class XMLHttpRequestEx {
    constructor() {
        /** @type {CacheItem} */
        this.oCacheItem;
        /** @type {Function} */
        this.evReadyStateChange;

        let ajaxRequest = /** @type {!XMLHttpRequestEx} */ ( new XMLHttpRequest() );

        return ajaxRequest;
    }
}

/** @abstract */
class CacheItem {
    /**
     * @param {LoaderImpl} oLoader
     * @param {string | null} sGroup 
     * @param {string | null} sKey 
     * @param {string} sUri 
     * @param {string} sType 
     * @param {Function | null} fnCallback
     */
    constructor(oLoader, sGroup, sKey, sUri, sType, fnCallback) {
        /** @protected */ this.oLoader = oLoader;
        this.sGroup = sGroup;
		this.sKey = sKey;
		this.sUri = sUri;
		this.aUri = (oLoader.fnFileNamePreprocessor === null) ? [ sUri ] : oLoader.fnFileNamePreprocessor(sUri);
		this.uIndex = 0;
        this.sType = sType;

        /** @private */ this.fnCallback = fnCallback;

        /** @protected @type {boolean} */ this.bReady;
        /** @private */ this.idRepeat = null;
        /** @private */ this.iRepeat = -1; // Infinite
        /** @private */ this.uRetry = 0;
		/** @private */ this.uNext = 0;
		
		/** @protected @type {XMLHttpRequestEx | null} */ this.ajaxRequest = null;
    }

    /**
	 * @protected
	 */
    bindAjax() {
        this.ajaxRequest.evReadyStateChange = this.evReadyStateChange.bind(this);
        bindEvent(this.ajaxRequest, 'readystatechange', this.ajaxRequest.evReadyStateChange);
	}

    /**
	 * @protected
	 */
    unbindAjax() {
		if (this.ajaxRequest === null)
			return;

		unbindEvent(this.ajaxRequest, 'readystatechange', this.ajaxRequest.evReadyStateChange);
		delete this.ajaxRequest.evReadyStateChange;
    }

    /**
	 * @protected
	 * @returns {boolean}
	 */
    createAjax() {
		if (this.ajaxRequest !== null) {
			return false;
		}

		this.bReady = false;
		this.ajaxRequest = new XMLHttpRequestEx();
		this.bindAjax();
		
		return true;
	}
	
	/**
	 * @protected
	 */
	startAjax() {
		this.ajaxRequest.open('GET', this.aUri[this.uIndex], true);
		this.ajaxRequest.responseType = LoaderResponseType.BLOB;
		this.ajaxRequest.send(null);
	}

	/**
	 * @protected
	 */
	stopAjax() {
        if (this.idRepeat !== null) {
            clearTimeout(this.idRepeat);
            this.idRepeat = null;
        }

		if (this.ajaxRequest !== null) {
			this.unbindAjax();

			if (this.bReady) {
				this.bReady = false;
			}

			this.ajaxRequest = null;
		}
	}

	/**
	 * @protected
	 */
    create() {
		if (this.createAjax())
			this.startAjax();
	}

    /**
	 * @abstract
	 * @protected
	 */
    cancel() {}

	/**
	 * @protected
	 */
    release() {
        this.oLoader.oCount.uError -= this.uRetry;
        this.uRetry = 0;

        this.cancel();
    }

	/**
	 * @protected
	 * @param {*} event
	 */
	evReadyStateChange(event) {
		if (this.ajaxRequest.readyState === 4) {
			this.onStatus(event, this.ajaxRequest.status);
		}
	}

	/**
	 * @private
	 * @param {*} event 
	 * @param {number} status
	 */
	onStatus(event, status) {
		/**
		 * 0 - Connection Error
		 * 200 - OK
		 * 400 - Resource Not Found
		 * 500 - Internal Server Error
		 */
		if (status === 200) {
			this.onLoadAjax(event);
		} else if ((status >= 400) && (status < 500)) {
			this.uIndex++;
			if (this.uIndex < this.aUri.length) {
				this.cancel();
				this.onErrorAjax();
				this.create();
			} else {
				this.uIndex = 0;
				this.onLoadError(false);
			}
		} else {
			this.onLoadError(true);
		}
	}

	/**
	 * @abstract
	 * @protected
	 * @param {*} event
	 */
	onLoadAjax(event) {}

	/**
	 * @protected
	 */
	onErrorAjax() {}

	/**
	 * @protected
	 */
	onLoadComplete() {
        this.oLoader.oCount.uError -= this.uRetry;
        this.bReady = true;
        this.oLoader.evLoad(this);
        if (this.fnCallback !== null) this.fnCallback(this);
	}

	/**
	 * @private
	 * @param {boolean} bRetry 
	 */
	onLoadError(bRetry) {
		this.oLoader.oCount.uError++;
		this.oLoader.bStatus = true;

		this.cancel();

		this.onErrorAjax();

		this.uRetry++;
		if ((bRetry) && ((this.iRepeat < 0) || (this.uRetry <= this.iRepeat))) {
			this.uNext += 3000 + ((Math.random() * 2000) | 0);
			if (this.uNext > 60000) this.uNext = 60000;
			this.idRepeat = setTimeout(this.create.bind(this), this.uNext);
		} else {
			this.oLoader.evError(this);
		}
	}

	/**
	 * @abstract
	 * @protected
	 * @param {*} event 
	 */
	evLoad(event) {}
	
	/**
	 * @protected
	 * @param {*} event
	 */
	evError(event) {
		this.onLoadError(true);
	}
}

/**
 * @extends {HTMLImageElement}
 */
class HTMLImageElementEx {
    constructor() {
        /** @type {Function} */
        this.evLoad;
        /** @type {Function} */
        this.evError;
        /** @type {Function} */
        this.release;

        let domImage = /** @type {!HTMLImageElementEx} */ (document.createElement('img'));

        return domImage;
    }
}

class CacheImage extends CacheItem {
    /**
     * @param {LoaderImpl} oLoader
     * @param {string | null} sGroup 
     * @param {string} sKey 
     * @param {string} sUri 
     * @param {Function | null} fnCallback
     */
    constructor(oLoader, sGroup, sKey, sUri, fnCallback) {
        super(oLoader, sGroup, sKey, sUri, LoaderSupportedType.IMAGE, fnCallback);

        /** @private @type {HTMLImageElementEx | null} */ this.domImage = null;
    }

	/**
	 * @private
	 */
	bindImage() {
		this.domImage.evLoad = this.evLoad.bind(this);
        this.domImage.evError = this.evError.bind(this);
        this.domImage.release = this.release.bind(this);

        bindEvent(this.domImage, 'load', this.domImage.evLoad);
        bindEvent(this.domImage, 'error', this.domImage.evError);
    }

    /**
	 * @private
	 */
    unbindImage() {
		if (this.domImage === null)
			return;

		unbindEvent(this.domImage, 'load', this.domImage.evLoad);
		unbindEvent(this.domImage, 'error', this.domImage.evError);

		delete this.domImage.evLoad;
		delete this.domImage.evError;
		delete this.domImage.release;
    }

	/**
	 * @private
	 */
    createImage() {
        if (this.domImage !== null)
            return;

        this.bReady = false;
        this.domImage = new HTMLImageElementEx();

        this.bindImage();

		Gallery.register(this.domImage);

        this.domImage.src = this.aUri[this.uIndex];
    }

	/**
	 * @protected
	 */
    cancel() {
		this.stopAjax();

        if (this.domImage !== null) {
	        Gallery.unregister(this.domImage);
        	this.unbindImage();

			if (this.bReady) {
				this.bReady = false;
				if (this.sKey !== null)
					Gallery.remove(this.sKey);
				this.oLoader.uncache(this);
			}

			this.domImage = null;
		}
    }

	/**
	 * @protected
	 * @param {*} event
	 */
	onLoadAjax(event) {
		this.unbindAjax();
		this.ajaxRequest = null;
		this.createImage();
	}

	/**
	 * @param {*} event
	 */
    evLoad(event) {
        this.unbindImage();
		Gallery.createTextureImage(this.sKey, this.domImage);
		this.oLoader.cache(this);
		this.onLoadComplete();
    }
}

/**
 * @extends {HTMLAudioElement}
 */
class HTMLAudioElementEx {
    constructor() {
        /** @type {Function} */
        this.evLoad;
        /** @type {Function} */
        this.evError;
        /** @type {Function} */
        this.evPause;
        /** @type {Function} */
        this.evDurationChange;
        /** @type {Function} */
        this.evEnded;
        /** @type {Function} */
        this.evCanPlayThrough;
        /** @type {Promise} */
        this.oPromise;
        /** @type {number} */
        this.uPromise;
        /** @type {function(Function=,Function=): Promise} */
        this.requestPlay;
        /** @type {Function} */
        this.requestPause;

        let domAudio = /** @type {HTMLAudioElementEx} */ (window.document.createElement('audio'));

        domAudio.oPromise = null;
        domAudio.uPromise = 0;
        domAudio.requestPlay = HTMLAudioElementEx.requestPlay.bind(domAudio);
        domAudio.requestPause = HTMLAudioElementEx.requestPause.bind(domAudio);

        return domAudio;
    }

    /**
     * @private
     * @this {HTMLAudioElementEx}
     * @param {Function=} fnSuccess
     * @param {Function=} fnFailure
     */
    static async requestPlay(fnSuccess, fnFailure) {
        let THIS = this;
        if (this.uPromise !== 0) {
            this.uPromise++;
            let uCheckPromise = this.uPromise;
            this.oPromise = this.oPromise.then(function() {
                if (THIS.uPromise == uCheckPromise) {
                    THIS.uPromise = 0;
                    THIS.oPromise = null;
                }

                THIS.uPromise++;
                uCheckPromise = THIS.uPromise;
                THIS.oPromise = THIS.play().then(function() {
                        if (THIS.uPromise == uCheckPromise) {
                            THIS.uPromise = 0;
                            THIS.oPromise = null;
                        }

                        if ((fnSuccess !== undefined) && (fnSuccess !== null)) fnSuccess();
                    })
                    .catch(function() {
                        if (THIS.uPromise == uCheckPromise) {
                            THIS.uPromise = 0;
                            THIS.oPromise = null;
                        }

                        if ((fnFailure !== undefined) && (fnFailure !== null)) fnFailure();
                    });
            });
        } else {
            this.uPromise++;
            let uCheckPromise = this.uPromise;
            this.oPromise = this.play().then(function() {
                    if (THIS.uPromise == uCheckPromise) {
                        THIS.uPromise = 0;
                        THIS.oPromise = null;
                    }

                    if ((fnSuccess !== undefined) && (fnSuccess !== null)) fnSuccess();
                })
                .catch(function() {
                    if (THIS.uPromise == uCheckPromise) {
                        THIS.uPromise = 0;
                        THIS.oPromise = null;
                    }

                    if ((fnFailure !== undefined) && (fnFailure !== null)) fnFailure();
                });
        }

        /* DEBUG
        try {
        	await this.play();
        	if ((fnSuccess !== undefined) && (fnSuccess !== null)) fnSuccess();
        } catch (e) {
        	console.log(e);
        	if ((fnFailure !== undefined) && (fnFailure !== null)) fnFailure();
        }
        */
    }

    /**
     * @private
     * @this {HTMLAudioElementEx}
     * @param {Function=} fnCallback
     */
    static requestPause(fnCallback) {
        if (this.uPromise !== 0) {
            let THIS = this;
            this.uPromise++;
            let uCheckPromise = this.uPromise;
            this.oPromise = this.oPromise.then(function() {
                if (THIS.uPromise == uCheckPromise) {
                    THIS.uPromise = 0;
                    THIS.oPromise = null;
                }

                THIS.pause();
                if (fnCallback !== undefined) fnCallback();
            });
        } else {
            this.pause()
            if (fnCallback !== undefined) fnCallback();
        }
    }
}

class CacheSound extends CacheItem {
    /**
     * @param {LoaderImpl} oLoader
     * @param {string | null} sGroup 
     * @param {string} sKey 
     * @param {string} sUri 
     * @param {Function | null} fnCallback
     */
    constructor(oLoader, sGroup, sKey, sUri, fnCallback) {
        super(oLoader, sGroup, sKey, sUri, LoaderSupportedType.SOUND, fnCallback);

        /** @private @type {HTMLAudioElementEx | null} */ this.domAudio = null;
        /** @private */ this.uSource = 0;
        /** @private */ this.uError = 0;

        /** @private */ this.bPlayAgain = false;
        /** @private @type {Function} */ this.evRequestPlayAgain = this.onRequestPlayAgain.bind(this);
        /** @private @type {Function} */ this.evRequestPlayFailed = this.onRequestPlayFailed.bind(this);
    }

    /**
	 * @private
	 */
    bindSound() {
        this.domAudio.evLoad = this.evLoad.bind(this);
        this.domAudio.evError = this.evError.bind(this);
        this.domAudio.evPause = this.evPause.bind(this);
        this.domAudio.evDurationChange = this.evDurationChange.bind(this);
        this.domAudio.evEnded = this.evEnded.bind(this);
        this.domAudio.evCanPlayThrough = this.evCanPlayThrough.bind(this);

        bindEvent(this.domAudio, 'error', this.domAudio.evError);
        bindEvent(this.domAudio, 'pause', this.domAudio.evPause);
        bindEvent(this.domAudio, 'durationchange', this.domAudio.evDurationChange);
        bindEvent(this.domAudio, 'ended', this.domAudio.evEnded);
        bindEvent(this.domAudio, 'canplaythrough', this.domAudio.evCanPlayThrough);
    }

    /**
	 * @private
	 */
    unbindSound() {
		this.bPlayAgain = false;

		if (MessagePool.unregister(evUserInteraction, this.evRequestPlayAgain)) {
            this.oLoader.uErrorUserInteractionCount--;
            if (this.oLoader.uErrorUserInteractionCount === 0) {
                this.oLoader.fErrorUserInteractionTick = getTickCounter();
            }
        }

        if (this.domAudio === null)
            return;

        for (let iIndex = 0; iIndex < this.domAudio.children.length; iIndex++) {
            let domSource = /** @type {HTMLSourceElement} */ (this.domAudio.children[iIndex]);
            unbindEvent(domSource, 'error', this.domAudio.evError);
        }

        unbindEvent(this.domAudio, 'error', this.domAudio.evError);
        unbindEvent(this.domAudio, 'pause', this.domAudio.evPause);
        unbindEvent(this.domAudio, 'durationchange', this.domAudio.evDurationChange);
        unbindEvent(this.domAudio, 'ended', this.domAudio.evEnded);
        unbindEvent(this.domAudio, 'canplaythrough', this.domAudio.evCanPlayThrough);

        delete this.domAudio.evLoad;
        delete this.domAudio.evError;
        delete this.domAudio.evPause;
        delete this.domAudio.evDurationChange;
        delete this.domAudio.evEnded;
        delete this.domAudio.evCanPlayThrough;
    }

	/**
	 * @override
	 * @protected
	 */
	startAjax() {
		let sPath = this.aUri[this.uIndex];
		let isSND = /\.snd$/i.test(sPath);
		if (isSND) {
			sPath = sPath.replace(/\.snd$/i, ".mp3");
		}

		this.ajaxRequest.open('GET', sPath, true);
		this.ajaxRequest.responseType = LoaderResponseType.BLOB;
		this.ajaxRequest.send(null);
	}

	/**
	 * @private
	 */
    createSound() {
        if (this.domAudio !== null)
            return;

        this.bReady = false;
        this.domAudio = new HTMLAudioElementEx();

        this.bindSound();

        this.domAudio.autoplay = false;
        this.domAudio.volume = VOLUME_MIN;
        this.domAudio.preload = "auto";

		let sPath = this.aUri[this.uIndex];
        let isSND = /\.snd$/i.test(sPath);
        let isOGG = /\.ogg$/i.test(sPath);
        let isMP3 = /\.mp3$/i.test(sPath);

        if (isMP3 || isSND) {
            let domSource = window.document.createElement('source');
            bindEvent( /** @type {HTMLElement} */ (domSource), 'error', this.domAudio.evError);
            this.uSource++;
            domSource.src = (isMP3 ? sPath : sPath.replace(/\.snd$/i, ".mp3"));
            domSource.type = 'audio/mpeg';
            this.domAudio.appendChild(domSource);
        }
        if (isOGG || isSND) {
            let domSource = window.document.createElement('source');
            bindEvent( /** @type {HTMLElement} */ (domSource), 'error', this.domAudio.evError);
            this.uSource++;
            domSource.src = (isOGG ? sPath : sPath.replace(/\.snd$/i, ".ogg"));
            domSource.type = "audio/ogg";
            this.domAudio.appendChild(domSource);
        }

        Mixer.register(this.domAudio);

        this.requestPlay();
    }

    /**
	 * @private
	 */
    requestPlay() {
        this.domAudio.currentTime = 0;
        this.domAudio.requestPlay(null, this.evRequestPlayFailed);
    }

    /**
	 * @private
	 */
    onRequestPlayAgain() {
        this.bPlayAgain = false;
        this.oLoader.uErrorUserInteractionCount--;
        if (this.oLoader.uErrorUserInteractionCount === 0) {
            this.oLoader.fErrorUserInteractionTick = getTickCounter();
        }
        this.requestPlay();
    }

    /**
	 * @private
	 */
    onRequestPlayFailed() {
        if (this.domAudio === null)
            return;

        this.bPlayAgain = true;
        MessagePool.registerOnce(evUserInteraction, this.evRequestPlayAgain);
        if (this.oLoader.uErrorUserInteractionCount === 0) {
            this.oLoader.fErrorUserInteractionTick = getTickCounter();
        }
        this.oLoader.uErrorUserInteractionCount++;

        //console.log('Unable to load sound resource, user interaction required! Press any key to continue...');
    }

	/**
	 * @protected
	 */
    cancel() {
		this.stopAjax();

        if (this.domAudio !== null) {
			this.uSource = 0;
			this.uError = 0;

			this.domAudio.requestPause();

			Mixer.unregister(this.domAudio);
			this.unbindSound();

			if (this.bReady) {
				this.bReady = false;
				if (this.sKey !== null)
					Mixer.remove(this.sKey);
				this.oLoader.uncache(this);
			}

			this.domAudio = null;
		}
    }

	/**
	 * @protected
	 * @param {*} event
	 */
	onLoadAjax(event) {
		this.unbindAjax();
		this.ajaxRequest = null;
		this.createSound();
	}

	/**
	 * @protected
	 * @param {*} event 
	 */
    evLoad(event) {
        this.unbindSound();
		Mixer.createSound(this.sKey, this.domAudio);
		this.oLoader.cache(this);
		this.onLoadComplete();
    }

    /**
	 * @private
	 * @param {*} event
	 */
    evPause(event) {
        //console.log(format("Pause {0}", this.sKey));

        if (this.bReady)
            this.evLoad(event);
    }

    /**
     * @private
     * @this {CacheSound}
     */
    static evReady() {
        this.bReady = true;
        if (this.domAudio !== null) {
            this.domAudio.currentTime = 0;
            this.domAudio.volume = 1;
        }
    }

    /**
	 * @private
	 * @param {*} event
	 */
    evDurationChange(event) {
        //console.log(format("Playing {0}", this.sKey));

        if (this.bPlayAgain)
            return;

        if (!this.bReady) {
            let THIS = this;
            this.domAudio.requestPause(function() {
                CacheSound.evReady.call(THIS);
            });
        }
    }

    /**
	 * @private
	 * @param {*} event
	 */
    evEnded(event) {
        //console.log(format("End {0}", this.sKey));
    }

    /**
	 * @private
	 * @param {*} event
	 */
    evCanPlayThrough(event) {
        //console.log(format("Buffered {0}", this.sKey));

        if (this.bPlayAgain)
            return;

        if (!this.bReady) {
            let THIS = this;
            this.domAudio.requestPause(function() {
                CacheSound.evReady.call(THIS);
            });
        }
    }
}

export class CacheData extends CacheItem {
    /**
     * @param {LoaderImpl} oLoader
     * @param {string | null} sGroup 
     * @param {string | null} sKey 
     * @param {string} sUri
     * @param {string} sExtension
     * @param {Function | null} fnCallback
     */
    constructor(oLoader, sGroup, sKey, sUri, sExtension, fnCallback) {
        super(oLoader, sGroup, sKey, sUri, typeOf(sExtension), fnCallback);

        this.sResponseType = responseTypeOf(sExtension);
        /** @type {*} */ this.oData = null;

        /** @private @type {Array<*>} */ this.aQuery = [];
        /** @private @type {Array<*>} */ this.aSending = [];
    }

    /**
     * @param {*} oMessage 
     * @returns {CacheData}
     */
    message(oMessage) {
        this.aQuery.push(oMessage);
        return this;
    }

	/**
	 * @override
	 * @protected
	 */
    startAjax() {
		let sPath = this.aUri[this.uIndex];
        if (this.aQuery.length > 0) {
            this.ajaxRequest.open('POST', sPath, true);
            this.ajaxRequest.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
        } else {
            this.ajaxRequest.open('GET', sPath, true);
        }
        this.ajaxRequest.responseType = this.sResponseType;

        if (this.aQuery.length > 0) {
            this.ajaxRequest.send(JSON.stringify({
                "token": this.oLoader.sToken,
                "sessid": this.oLoader.sSession,
                "count": this.aQuery.length,
                "data": this.aQuery
            }));
            this.aSending = this.aQuery;
            this.aQuery = [];
        } else {
            this.ajaxRequest.send(null);
        }
    }

	/**
	 * @protected
	 */
    cancel() {
		this.stopAjax();
	}

	/**
	 * @override
	 * @protected
	 */
    release() {
		super.release();

		this.aQuery = [];
        this.aSending = [];
    }

	/**
	 * @protected
	 * @param {*} event
	 */
	onLoadAjax(event) {
		this.unbindAjax();
		this.evLoad(event);
		this.ajaxRequest = null;
	}

	/**
	 * @override
	 * @protected
	 */
	onErrorAjax() {
        if (this.aQuery.length > 0) {
            for (let iIndex = 0; iIndex < this.aQuery.length; iIndex++) {
                this.aSending.push(this.aQuery[iIndex]);
            }
            this.aQuery = this.aSending;
            this.aSending = [];
        }
	}

	/**
	 * @protected
	 * @param {*} event
	 */
    evLoad(event) {
        this.aSending = [];

        if (this.ajaxRequest.responseType == "") {
            if (this.sResponseType == LoaderResponseType.JSON)
                try {
                    this.oData = JSON.parse(this.ajaxRequest.responseText);
                } catch (e) {
                    console.log(e);
                    this.oData = null;
                }
            else
                this.oData = this.ajaxRequest.responseText;
        } else
            this.oData = this.ajaxRequest.response;

		this.onLoadComplete();
    }
}

/** @typedef {Object<string, Object<string, CacheItem>>} LoaderCache */
var LoaderCache;

class QueueItem {
    /**
     * @param {CacheItem | null} oCacheItem 
     * @param {Function=} fnCallback 
     */
    constructor(oCacheItem, fnCallback) {
        this.oCacheItem = oCacheItem;
        this.fnCallback = fnCallback || null;
    }
}

class LoaderImpl {
    constructor() {
        this.guiLoading = new RenderLoading(this);
        /** @private */ this.sBasePath = ROOT;

        /** @private @type {LoaderCache} */
        this.oCache = {};
        /** @private @type {Array<string | Function>} */
        this.aSearch = [];
        /** @private @type {Array<QueueItem>} */
        this.aQueue = [];
        /** @private @type {Array<CacheItem>} */
        this.aLoading = [];

        /** @private */
        this.bStatus = false;
        /** @private @type {LoaderStatus} */
        this.oCount = {
            uTotal: 0,
            uComplete: 0,
            uError: 0,
        };

        /** @private @type {Function} */
        this.evUpdate = this.update.bind(this);
        /** @private @type {number | null} */
        this.idUpdate = null;

        /** @type {TextureImpl} */
        this.imgLoading = null;
        /** @private @type {number} */
        this.uErrorUserInteractionCount = 0;
        /** @private @type {number} */
		this.fErrorUserInteractionTick = 0;
		
		/** @private */ this.sToken = "unknown";
		/** @private */ this.sSession = "unknown";

		/** @type {function(string):Array<string> | null} */
		this.fnFileNamePreprocessor = null;
	}

	/**
	 * @param {string} sToken 
	 * @param {string} sSession 
	 */
	setAuth(sToken, sSession) {
		this.sToken = sToken;
		this.sSession = sSession;
	}

    /**
     * @param {string} sBasePath 
     */
    setBasePath(sBasePath) {
        this.sBasePath = ROOT + sBasePath.replace(/\\/g, '/').replace(/\/$/, '') + '/';
    }

    /**
     * @param {*} oConfig
     * @param {Function=} fnCallback
     * @param {*=} oThis
     * @param {...*} va_args
     */
    load(oConfig, fnCallback, oThis, va_args) {
		for (var sGroup in oConfig) {
			if (oConfig.hasOwnProperty(sGroup)) {
				this.loadGroup(sGroup, oConfig[sGroup], null);
			}
		}

        if ((fnCallback !== undefined) && (fnCallback !== null)) {
            let args = Array.prototype.slice.call(arguments, 2);
            this.aSearch.push(fnCallback);
            this.aQueue.push(new QueueItem(null, fnCallback.bind.apply(fnCallback, args)));
            this.oCount.uTotal++;
        }
    }

    /**
     * @param {string} sGroup 
     * @param {*} oGroup 
     * @param {Function=} fnCallback
     */
    loadGroup(sGroup, oGroup, fnCallback) {
        if (typeof oGroup === 'string') {
            let oURI = new URI(this.sBasePath, oGroup);
            this.loadUri(sGroup, oURI.sFile, oURI, null);
        } else if (Array.isArray(oGroup)) {
            for (let i = 0; i < oGroup.length; i++) {
                let oURI = new URI(this.sBasePath, oGroup[i]);
                this.loadUri(sGroup, oURI.sFile, oURI, null);
            }
        } else {
            for (let sKey in oGroup) {
				if (oGroup.hasOwnProperty(sKey)) {
                	let oURI = new URI(this.sBasePath, oGroup[sKey]);
					this.loadUri(sGroup, sKey, oURI, null);
				}
            }
		}
		
        if ((fnCallback !== undefined) && (fnCallback !== null)) {
            this.aSearch.push(fnCallback);
            this.aQueue.push(new QueueItem(null, fnCallback));
            this.oCount.uTotal++;
        }
    }

    /**
     * @param {string} sGroup 
     * @param {string} sKey 
     * @param {string} sURL 
     * @param {Function=} fnCallback
     */
    loadUrl(sGroup, sKey, sURL, fnCallback) {
        let oURI = new URI(this.sBasePath, sURL);
        this.loadUri(sGroup, sKey, oURI, fnCallback);
    }

    /**
     * @private
     * @param {string} sGroup 
     * @param {string} sKey 
     * @param {URI} oURI 
     * @param {Function=} fnCallback
     */
    loadUri(sGroup, sKey, oURI, fnCallback) {
        /** @type {QueueItem} */
        let oQueueItem;

        let sType = typeOf(oURI.sExtension);
        let sPath = oURI.build();
        if (sType == LoaderSupportedType.IMAGE) {
            oQueueItem = new QueueItem(new CacheImage(this, sGroup, sKey, sPath, fnCallback || null), null);
        } else if (sType == LoaderSupportedType.SOUND) {
            oQueueItem = new QueueItem(new CacheSound(this, sGroup, sKey, sPath, fnCallback || null), null);
        } else {
            oQueueItem = new QueueItem(new CacheData(this, sGroup, sKey, sPath, oURI.sExtension, fnCallback || null), null);
        }

        this.aSearch.push(sGroup + ':' + sKey + ':' + sPath);
        this.aQueue.push(oQueueItem);
        this.oCount.uTotal++;
    }

    /**
     * @param {string} sURL 
     * @param {Function=} fnCallback
     */
    loadJson(sURL, fnCallback) {
        let oURI = new URI(this.sBasePath, sURL);
		
		/** @type {QueueItem} */
		let oQueueItem;
		
        let sPath = oURI.build();
        oQueueItem = new QueueItem(new CacheData(this, null, null, sPath, ".json", fnCallback || null), null);

        this.aSearch.push(null + ':' + null + ':' + sPath);
        this.aQueue.push(oQueueItem);
        this.oCount.uTotal++;
    }

    /**
     * @param {*} oConfig
     * @param {Function=} fnCallback
     */
    unload(oConfig, fnCallback) {
		for (var sGroup in oConfig) {
			if (oConfig.hasOwnProperty(sGroup)) {
				this.unloadGroup(sGroup, oConfig[sGroup], null);
			}
		}

		if ((fnCallback !== undefined) && (fnCallback !== null)) {
            let iIndex = this.aSearch.indexOf(fnCallback);
            if (iIndex >= 0) {
                this.aSearch.splice(iIndex, 1);
                this.aQueue.splice(iIndex, 1);
                this.oCount.uTotal--;
            }
        }
    }

    /**
     * @param {string} sGroup 
     * @param {*} oGroup 
     * @param {Function=} fnCallback
     */
    unloadGroup(sGroup, oGroup, fnCallback) {
        if (typeof oGroup === 'string') {
            let oURI = new URI(this.sBasePath, oGroup);
            this.unloadUri(sGroup, oURI.sFile, oURI);
        } else if (Array.isArray(oGroup)) {
            for (let i = 0; i < oGroup.length; i++) {
                let oURI = new URI(this.sBasePath, oGroup[i]);
                this.unloadUri(sGroup, oURI.sFile, oURI);
            }
        } else {
            for (let sKey in oGroup) {
				if (oGroup.hasOwnProperty(sKey)) {
                	let oURI = new URI(this.sBasePath, oGroup[sKey]);
					this.unloadUri(sGroup, sKey, oURI);
				}
            }
		}
		
        if ((fnCallback !== undefined) && (fnCallback !== null)) {
            let iIndex = this.aSearch.indexOf(fnCallback);
            if (iIndex >= 0) {
                this.aSearch.splice(iIndex, 1);
                this.aQueue.splice(iIndex, 1);
                this.oCount.uTotal--;
            }
        }
    }

    /**
     * @param {string} sGroup 
     * @param {string} sKey 
     * @param {string} sURL 
     */
    unloadUrl(sGroup, sKey, sURL) {
        let oURI = new URI(this.sBasePath, sURL);
        this.unloadUri(sGroup, sKey, oURI);
    }

    /**
     * @private
     * @param {string} sGroup 
     * @param {string} sKey 
     * @param {URI} oURI 
     */
    unloadUri(sGroup, sKey, oURI) {
        let sSearch = sGroup + ':' + sKey + ':' + oURI.build();
        let iIndex = this.aSearch.indexOf(sSearch);
        if (iIndex >= 0) {
            this.aSearch.splice(iIndex, 1);
            this.aQueue.splice(iIndex, 1);
            this.oCount.uTotal--;
        }

		if (this.oCache[sGroup] === undefined)
			return;
		if (this.oCache[sGroup].hasOwnProperty(sKey)) {
			let o = /** @type {*} */ (this.oCache[sGroup]);
			delete o[sKey];
		}
    }

    /**
     * @param {string} sURL 
     * @param {*} oMessage 
     * @param {Function} fnCallback
     */
    query(sURL, oMessage, fnCallback) {
        let oURI = new URI(this.sBasePath, sURL);
        let sUri = oURI.build();
        for (let i = this.aQueue.length - 1; i >= 0; i--) {
            let oQueueItem = this.aQueue[i];
            if (oQueueItem.oCacheItem !== null) {
                if (oQueueItem.oCacheItem.sUri == sUri) {
                    let oCacheData = /** @type {CacheData} */ (oQueueItem.oCacheItem);
                    oCacheData.message(oMessage);
                    return;
                }
            }
        }

        let oCacheData = new CacheData(this, 'api', 'query', sUri, oURI.sExtension, fnCallback).message(oMessage);
        this.aSearch.push('api:query:' + sUri);
        this.aQueue.push(new QueueItem(oCacheData, null));
        this.oCount.uTotal++;
    }

    /** @private */
    update() {
        let uMaxCount = uMaxParallelJobs - this.aLoading.length;
        let iCount = this.aQueue.length;
        if (this.oCount.uError > 0) iCount = 0;
        if (iCount > uMaxCount) iCount = uMaxCount;
        if (iCount == 0) iCount = -1;
        else if (this.bStatus) {
			MessagePool.recv(evLoaderStatus, this.oCount);
            this.bStatus = false;
        }
        while (iCount > 0) {
            let oQueueItem = this.aQueue[0];
            if (oQueueItem.oCacheItem === null) {
                if (this.aLoading.length === 0) {
                    this.aSearch.shift();
                    this.aQueue.shift();
                    this.oCount.uComplete++;
                    oQueueItem.fnCallback();
                } else {
                    break;
                }
            } else {
                this.aSearch.shift();
                this.aQueue.shift();
                this.aLoading.push(oQueueItem.oCacheItem);
                oQueueItem.oCacheItem.create();
            }
            iCount--;
        }
        if ((this.aLoading.length > 0) || (iCount === 0)) {
            this.idUpdate = setTimeout(this.evUpdate, 15);
        } else {
            this.idUpdate = null;

            if (this.oCount.uError > 0)
				MessagePool.recv(evLoaderTerminate);
            else {
				MessagePool.recv(evLoaderComplete, this.oCache);
            }
			MessagePool.recv(evLoaderStop);
        }
    }

    run() {
        this.imgLoading = Gallery.get(sLoadingTexture);
        if (this.idUpdate === null) {
			MessagePool.recv(evLoaderStart);
            this.idUpdate = setTimeout(this.evUpdate, 15);
        }
    }

    stop() {
        if (this.idUpdate !== null) {
            clearTimeout(this.idUpdate);
            this.idUpdate = null;
        }

        for (let iIndex = this.aLoading.length - 1; iIndex >= 0; iIndex--) {
            let oCacheItem = this.aLoading[iIndex];
            oCacheItem.cancel();
            let oQueueItem = new QueueItem(oCacheItem, null);
            this.aSearch.unshift(oCacheItem.sGroup + ':' + oCacheItem.sKey + ':' + oCacheItem.sUri);
            this.aQueue.unshift(oQueueItem);
        }
        this.aLoading = [];
    }

    release() {
        if (this.idUpdate !== null) {
            clearTimeout(this.idUpdate);
            this.idUpdate = null;
        }

        for (let iIndex = this.aLoading.length - 1; iIndex >= 0; iIndex--) {
            this.aLoading[iIndex].release();
        }
        this.aLoading = [];

        for (let iIndex = this.aQueue.length - 1; iIndex >= 0; iIndex--) {
            let oQueueItem = this.aQueue[iIndex];
            if (oQueueItem.oCacheItem !== null)
                oQueueItem.oCacheItem.release();
        }
        this.aSearch = [];
        this.aQueue = [];

        for (let sGroup in this.oCache) {
            let oGroup = this.oCache[sGroup];
			for (let sKey in oGroup) {
				if (oGroup.hasOwnProperty(sKey)) {
					let oCacheItem = /** @type {CacheItem} */ (oGroup[sKey]);
					oCacheItem.release();
				}
			}
        }
        this.oCache = {};

        this.oCount.uTotal = 0;
        this.oCount.uComplete = 0;
        this.oCount.uError = 0;
    }

    /**
	 * @protected
     * @param {CacheItem} oCacheItem
     */
    cache(oCacheItem) {
		if ((oCacheItem.sKey !== null) && (oCacheItem.sGroup !== null)) {
			if (this.oCache[oCacheItem.sGroup] === undefined)
				this.oCache[oCacheItem.sGroup] = {};

			let o = /** @type {*} */ (this.oCache[oCacheItem.sGroup]);
			o[oCacheItem.sKey] = oCacheItem;
		}
    }

    /**
	 * @protected
     * @param {CacheItem} oCacheItem
     */
    uncache(oCacheItem) {
		if ((oCacheItem.sKey !== null) && (oCacheItem.sGroup !== null)) {
			if (this.oCache[oCacheItem.sGroup] === undefined)
				return;
			if (this.oCache[oCacheItem.sGroup].hasOwnProperty(oCacheItem.sKey)) {
				let o = /** @type {*} */ (this.oCache[oCacheItem.sGroup]);
				delete o[oCacheItem.sKey];
			}
		}
	}
	
	/**
	 * @param {string} sGroup 
	 * @param {string} sKey 
	 * @returns {CacheItem | null}
	 */
	get(sGroup, sKey) {
		if (this.oCache.hasOwnProperty(sGroup)) {
			let oGroup = this.oCache[sGroup];
			if (oGroup.hasOwnProperty(sKey)) {
				let oCacheItem = /** @type {CacheItem} */ (oGroup[sKey]);
				return oCacheItem;
			}
		}

		return null;
	}

    /**
	 * @protected
     * @param {CacheItem} oCacheItem
     */
    evLoad(oCacheItem) {
        this.oCount.uComplete++;
        this.bStatus = true;
        let iIndex = this.aLoading.indexOf(oCacheItem);
		this.aLoading.splice(iIndex, 1);
		MessagePool.recv(evLoaderFile, oCacheItem);
    }

    /**
	 * @protected
     * @param {CacheItem} oCacheItem
     */
    evError(oCacheItem) {
        this.oCount.uError++;
        this.bStatus = true;
        let iIndex = this.aLoading.indexOf(oCacheItem);
        this.aLoading.splice(iIndex, 1);
        MessagePool.recv(evLoaderError, oCacheItem);
    }
}

const aRGBARed = [1, 0, 0, 1];

class RenderArc {
	/**
	 * @param {number=} uArcElements
	 */
    constructor(uArcElements) {
		this.uArcElements = (uArcElements || 5) * 2;
        this.aBack = RenderArc.generateArcs(this.uArcElements);
        this.aFront = RenderArc.generateArcs(this.uArcElements);
        this.fOffset = 0;

        let fSign = (Math.random() < 0.5) ? -1 : 1;
        this.fSpeed = fSign * (Math.random() * 0.5 + 0.5) * 2 * Math.PI / 360;
        this.fHUE = Math.random() * 360;
        this.fSaturation = Math.random() * 0.5 + 0.5;
        this.fIntensity = Math.random() * 0.5 + 0.5;
    }

    /**
	 * @private
	 * @param {number} uArcElements
	 * @returns {Array<number>}
	 */
    static generateArcs(uArcElements) {
        /** @type {Array<number>} */
        let aArcs = [];
        let fOffset = Math.random() + 0.01;
        for (let i = 0; i < uArcElements; i++) {
            aArcs.push(fOffset);
            fOffset += Math.random() + 0.01;
        }
        fOffset += Math.random() + 0.01;
        for (var i = 0; i < uArcElements; i++) {
            aArcs[i] = aArcs[i] * 2 * Math.PI / fOffset;
        }
        return aArcs;
    }

    /**
     * @private
     * @param {CanvasRenderingContext2D} oContext 
     * @param {number} iX 
     * @param {number} iY 
     * @param {number} fSize 
     * @param {Array<number>} aArc 
     * @param {number} fOffset 
	 * @param {number} uArcElements
     */
    static renderArc(oContext, iX, iY, fSize, aArc, fOffset, uArcElements) {
        for (let i = 0; i < uArcElements; i += 2) {
            oContext.beginPath();
            oContext.arc(iX, iY, fSize, aArc[i] + fOffset, aArc[i + 1] + fOffset, false);
            oContext.stroke();
        }
    }

    /**
     * @param {CanvasRenderingContext2D} oContext 
     * @param {number} iX 
     * @param {number} iY 
     * @param {number} fSize 
	 * @param {number} fScale
	 * @param {number} fError
     */
    render(oContext, iX, iY, fSize, fScale, fError) {
        oContext.lineWidth = 0.07 * fScale;
        oContext.lineCap = 'square';
        oContext.strokeStyle = '#000000';
        RenderArc.renderArc(oContext, iX, iY, fSize, this.aBack, this.fOffset / 2, this.uArcElements);
        RenderArc.renderArc(oContext, iX, iY, fSize, this.aFront, this.fOffset, this.uArcElements);
		oContext.lineWidth = 0.05 * fScale;
        oContext.strokeStyle = RGBA2STR(MorphRGBA(aRGBARed, HSIA2RGBA(this.fHUE, this.fSaturation, this.fIntensity, 0.5), fError));
        RenderArc.renderArc(oContext, iX, iY, fSize, this.aBack, this.fOffset / 2, this.uArcElements);
        oContext.strokeStyle = RGBA2STR(MorphRGBA(aRGBARed, HSIA2RGBA(this.fHUE, this.fSaturation, this.fIntensity, 1.0), fError));
        RenderArc.renderArc(oContext, iX, iY, fSize, this.aFront, this.fOffset, this.uArcElements);
    }
}

class RenderLoading {
    /**
	 * @param {LoaderImpl} oLoader
	 * @param {number=} uArcsCount
	 */
    constructor(oLoader, uArcsCount) {
		this.oLoader = oLoader;
		this.uArcsCount = uArcsCount || 5;
        /** @type {Array<RenderArc>} */
        this.guiArcs;
        this.reset();
    }

    reset() {
        this.guiArcs = [];

        for (let i = 0; i < this.uArcsCount; i++) {
            this.guiArcs.push(new RenderArc());
        }
    }

    /**
     * @param {CanvasRenderingContext2D} oContext 
     * @param {number} iX 
     * @param {number} iY 
     */
    render(oContext, iX, iY, fScale) {
        let fErrorInterval = getTickCounter() - this.oLoader.fErrorUserInteractionTick;
        let fErrorDistance = (this.oLoader.fErrorUserInteractionTick === 0) ? 1 : (
            (this.oLoader.uErrorUserInteractionCount === 0) ? Math.min(fErrorInterval / 250, 1) : Math.max(1 - (fErrorInterval / 250), 0)
        );

        if (this.oLoader.imgLoading !== null) {
            oContext.drawImage(this.oLoader.imgLoading.domElement, 0, 0);
        }

        for (let i = 0; i < this.uArcsCount; i++) {
            let guiArc = this.guiArcs[i];
            var fSize = (i * 0.10 + 0.50) * fScale;
            guiArc.render(oContext, iX, iY, fSize, fScale, fErrorDistance);
            guiArc.fOffset += guiArc.fSpeed;
            if (guiArc.fOffset >= 4 * Math.PI) guiArc.fOffset -= 4 * Math.PI;
            if (guiArc.fOffset < 0) guiArc.fOffset += 4 * Math.PI;
        }

        if (fErrorDistance < 1) {
            if ((((fErrorInterval / 500) | 0) % 2) == 0) {
                oContext.font = "normal " + ((0.4 * fScale) | 0) + "px Arial";
                oContext.textAlign = "center";
                oContext.textBaseline = "middle";
                oContext.strokeStyle = "#000000";
                oContext.lineWidth = 0.03 * fScale;
                oContext.strokeText(sPressAnyKey, iX, iY);
                oContext.fillStyle = "#80CCFF";
                oContext.fillText(sPressAnyKey, iX, iY);
            }
        } else {
            let iPercent = (this.oLoader.oCount.uComplete * 100 / this.oLoader.oCount.uTotal) | 0;
            if (iPercent >= 100) iPercent = 99;
            if (iPercent > 0) {
                let sText = iPercent + '%';

                oContext.font = "normal " + ((0.28 * fScale) | 0) + "px Arial";
                oContext.textAlign = "center";
                oContext.textBaseline = "middle";
                oContext.strokeStyle = "#000000";
                oContext.lineWidth = 0.03 * fScale;
                oContext.strokeText(sText, iX, iY);
                oContext.fillStyle = "#80CCFF";
                oContext.fillText(sText, iX, iY);
            }
        }
    }
}

/** @type {LoaderImpl | null} */
export let Loader = new LoaderImpl();

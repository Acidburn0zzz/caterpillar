// Copyright 2015 Google Inc. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Polyfill for Chrome Apps' storage API.
 */

'use strict';

if (!chrome.storage)
  chrome.storage = {};

chrome.caterpillar.storage = {};

(function() {

/**
 * Triggers a chrome.storage.onChanged event on self.
 *
 * This is used internally within the polyfill to manage change events; event
 * information is stored in event.detail.
 *
 * @param {object} items Object mapping keys to StorageChanges containing the
 *     new and old values of each item.
 */
function triggerOnChanged(items) {
  var event = new CustomEvent('chrome.storage.onChanged', {'detail': items});
  self.dispatchEvent(event);
};

/**
 * Stores onChanged event listeners.
 */
var onChangedListeners = [];

/**
 * Represents a change in stored data.
 */
chrome.storage.StorageChange = class {
  /**
   * @param {object=} opt_oldValue The old value of the item.
   * @param {object=} opt_newValue The new value of the item.
   */
  constructor(opt_oldValue, opt_newValue) {
    this.oldValue = opt_oldValue;
    this.newValue = opt_newValue;
  }
};

/**
 * Represents an area where data can be stored.
 *
 * Chrome Apps have three such areas - sync, local, managed.
 */
chrome.storage.StorageArea = class {
  /**
   * Gets one or more items from storage.
   *
   * @param {string= | string[]= | object=} opt_keys A single key to get, list
   *     of keys to get, or a dictionary specifying default values. Empty lists
   *     or objects return empty results. Pass null to get all contents.
   * @param {function} callback Callback with storage items, or on failure.
   */
  get(opt_keys, callback) {
    // Juggle arguments.
    if (callback === undefined) {
      // Keys wasn't actually given, the callback was.
      callback = opt_keys;
      opt_keys = null;
    }

    // Four scenarios:
    // 1. Input is a single string key; retrieve associated value.
    // 2. Input is multiple string keys; retrieve associated values.
    // 3. Input is a map from string key to default value; retrieve associated
    //  values and rely on defaults if necessary.
    // 4. Input is null; retrieve all key/value pairs.

    var handleError = function(err) {
       chrome.caterpillar.setError('Error retrieving values: ' + err);
       callback();
    }

    if (typeof opt_keys === 'string')
      opt_keys = [opt_keys];

    if (opt_keys === null) {
      // null input; get all key/value pairs.
      var items = {};
      localforage.iterate(function (value, key) { items[key] = value; })
          .then(callback.bind(this, items))
          .catch(handleError);
    } else if (Array.isArray(opt_keys)) {
      // Array input; get associated values of each key.
      var valuePromises = opt_keys.map(key => localforage.getItem(key));
      Promise.all(valuePromises)
          .then(values => {
            // The callback expects a map from keys to values, but
            // localforage just gives us values.
            var items = {};
            for (var i = 0; i < opt_keys.length; i++) {
              items[opt_keys[i]] = values[i];
            }
            callback(items);
          })
          .catch(handleError);
    } else {
      // Object input; get associated values with defaults.
      var keys = Object.keys(opt_keys);
      Promise.all(keys.map(key => localforage.getItem(key)))
          .then(values => {
            var items = {};
            for (var i = 0; i < keys.length; i++) {
              if (values[i] === null) {
                items[keys[i]] = opt_keys[keys[i]];
              } else {
                items[keys[i]] = values[i];
              }
            }
            callback(items);
          })
          .catch(handleError);
    }
  }

  /**
   * Gets the amount of space (in bytes) being used by one or more items.
   *
   * Not implemented in this polyfill.
   *
   * @param {string= | string[]= | object=} opt_keys A single key to get,
   *     list of keys to get, or a dictionary specifying default values. Empty
   *      lists or objects return 0. Pass null to get total usage.
   * @param {function} callback Callback with bytes in use, or failure.
   */
  getBytesInUse(opt_keys, callback) {
    // Juggle arguments.
    if (callback === undefined) {
      callback = opt_keys;
      opt_keys = null;
    }
    // IndexedDB doesn't support this, so neither does localforage.
    chrome.caterpillar.setError('getBytesInUse not implemented.');
    callback();
  }

  /**
   * Sets multiple items.
   *
   * @param {object} items An object which gives key/value pairs to update
   *     storage with. Other key/value pairs in storage will not be affected.
   * @param {function=} opt_callback Callback on success or failure.
   */
  set(items, opt_callback) {
    var keys = Object.keys(items);
    try {
      // We need to trigger an event containing all the old values and new values.
      // To do that, we first need the old values.
      this.get(keys, function (oldItems) {
        // Now that we have the old values, we can set the new values.
        Promise.all(keys.map(key => localforage.setItem(key, items[key])))
            // Then setup the input and trigger the event.
            .then(function() {
              var changes = {};
              for (var key of keys) {
                changes[key] = new chrome.storage.StorageChange(
                    oldItems[key], items[key]);
              }
              triggerOnChanged(changes);
              if (opt_callback)
                opt_callback();
            });
      });
    } catch (e) {
      chrome.caterpillar.setError('Error setting values: ' + (e.message || e));
      if (opt_callback)
        opt_callback();
    }
  }

  /**
   * Removes one or more items from storage.
   *
   * @param {string || string[]} keys A single key or a list of keys to
   *     remove.
   * @param {function=} opt_callback Callback on success or failure.
   */
  remove(keys, opt_callback) {
    var handleError = function(err) {
      chrome.caterpillar.setError('Error removing keys: ' + err);
      if (opt_callback)
        opt_callback();
    };
    try {
      this.get(keys, function(items) {
        if (typeof keys === 'string')
          keys = [keys];

        Promise.all(keys.map(key => localforage.removeItem(key)))
            .then(function() {
              var changes = {};
              for (var key of keys) {
                changes[key] = new chrome.storage.StorageChange(
                    items[key], null);
              }
              triggerOnChanged(changes);
              if (opt_callback)
                opt_callback();
            })
      });
    } catch (e) {
      handleError(e.message || e);
    }
  }

  /**
   * Removes all items from storage.
   *
   * @param {function=} opt_callback Callback on success or failure.
   */
  clear(opt_callback) {
    try {
      this.get(function(items) {
        var changes = {};
        for (var key in items) {
          changes[key] = new chrome.storage.StorageChange(items[key], null);
        }
        localforage.clear().then(function() {
          triggerOnChanged(changes);
          if (opt_callback)
            opt_callback();
        });
      });
    } catch (e) {
      chrome.caterpillar.setError('Error clearing values: ' + (e.message || e));
      if (opt_callback)
        opt_callback();
    }
  }
};

/**
 * Items in the local storage area are stored locally.
 */
chrome.storage.local = new chrome.storage.StorageArea();

/**
 * Items in the sync storage area would be synced using Chrome Sync; in this
 * polyfill we just use local storage.
 */
chrome.storage.sync = chrome.storage.local;

/**
 * Items in the managed storage area are read-only usually; in this polyfill
 * managed is the same as local storage.
 */
chrome.storage.managed = chrome.storage.local;

/**
 * Namespace.
 */
chrome.storage.onChanged = {};

/**
 * Adds an event listener for the onChanged event.
 *
 * @param {function} callback Function taking an object mapping changed keys to
 *     StorageChanges and an area name (though the latter will always be null).
 */
chrome.storage.onChanged.addListener = function(callback) {
  var listener = function(e) {
    callback(e.detail, null);
  };

  self.addEventListener('chrome.storage.onChanged', listener);
  onChangedListeners.push(listener);
};

/**
 * Resets onChanged event listeners. Used for testing.
 */
chrome.caterpillar.storage.resetOnChangedListenersForTests = function() {
  for (var listener of onChangedListeners) {
    self.removeEventListener('chrome.storage.onChanged', listener);
  }

  onChangedListeners.length = 0;
};

}).call(this);

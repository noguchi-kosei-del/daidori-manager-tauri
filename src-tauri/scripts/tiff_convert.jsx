// Photoshop JSX Script for TIFF Conversion
// Daidori Manager - PSD to TIFF batch conversion

#target photoshop

var originalDialogs = app.displayDialogs;
app.displayDialogs = DialogModes.NO;
app.preferences.rulerUnits = Units.PIXELS;

/* -----------------------------------------------------
  Main Processing
 ----------------------------------------------------- */
function main() {
    var tempFolder = Folder.temp;
    var settingsFile = new File(tempFolder + "/daidori_tiff_settings.json");

    if (!settingsFile.exists) {
        alert("Settings file not found: " + settingsFile.fsName);
        return;
    }

    settingsFile.open("r");
    settingsFile.encoding = "UTF-8";
    var jsonStr = settingsFile.read();
    settingsFile.close();

    // BOM skip
    if (jsonStr.charCodeAt(0) === 0xFEFF || jsonStr.charCodeAt(0) === 0xEF) {
        jsonStr = jsonStr.substring(1);
    }

    var config;
    try {
        config = parseJSON(jsonStr);
    } catch (e) {
        alert("Failed to parse settings: " + e.message);
        return;
    }

    var globalSettings = config.globalSettings;
    var results = [];

    // Initial heartbeat
    try {
        var pf = new File(tempFolder + "/daidori_tiff_progress.txt");
        pf.open("w"); pf.write("0/" + String(config.files.length)); pf.close();
    } catch (e_hb0) {}

    for (var i = 0; i < config.files.length; i++) {
        var fileConfig = config.files[i];
        var result = processFile(fileConfig, globalSettings);
        results.push(result);

        // Heartbeat progress
        try {
            var progressFile = new File(tempFolder + "/daidori_tiff_progress.txt");
            progressFile.open("w");
            progressFile.write(String(i + 1) + "/" + String(config.files.length));
            progressFile.close();
        } catch (e_hb) {}
    }

    // Write results
    var resultFile = new File(tempFolder + "/daidori_tiff_results.json");
    resultFile.open("w");
    resultFile.encoding = "UTF-8";
    resultFile.write(valueToJSON({ results: results }));
    resultFile.close();

    app.displayDialogs = originalDialogs;
}

/* -----------------------------------------------------
  Process Single File
 ----------------------------------------------------- */
function processFile(fileConfig, globalSettings) {
    var filePath = fileConfig.path;
    var fileName = decodeURI(new File(filePath).name);

    try {
        // 1. Open file
        var file = new File(filePath);
        if (!file.exists) {
            return { fileName: fileName, success: false, error: "File not found" };
        }

        var doc = app.open(file);

        // 2. Unlock all layers
        unlockAllLayers(doc);

        // 3. Flatten image (merge all layers)
        if (globalSettings.flattenImage) {
            doc.flatten();
        }

        // 4. Color mode conversion
        // 元のドキュメントのカラーモードを保存
        var originalMode = doc.mode;
        var targetColorMode = fileConfig.colorMode || globalSettings.colorMode;

        // グレースケール設定でも、元がRGBの場合はRGBを維持する
        if (targetColorMode === "grayscale") {
            if (originalMode === DocumentMode.RGB) {
                // 元がRGBの場合はRGBを維持（変換しない）
                // RGBのままTIFF出力される
            } else if (doc.mode !== DocumentMode.GRAYSCALE) {
                // 元がRGB以外（CMYKなど）の場合はグレースケールに変換
                doc.changeMode(ChangeMode.GRAYSCALE);
            }
        } else if (targetColorMode === "rgb" && doc.mode !== DocumentMode.RGB) {
            doc.changeMode(ChangeMode.RGB);
        }

        // 5. Resize if specified
        if (globalSettings.targetWidth && globalSettings.targetHeight) {
            var targetW = new UnitValue(globalSettings.targetWidth, "px");
            var targetH = new UnitValue(globalSettings.targetHeight, "px");
            var targetDPI = globalSettings.targetDPI || doc.resolution;
            doc.resizeImage(targetW, targetH, targetDPI, ResampleMethod.AUTOMATIC);
        }

        // 6. Remove alpha channels
        while (doc.channels.length > getExpectedChannelCount(doc)) {
            doc.channels[doc.channels.length - 1].remove();
        }

        // 7. Save
        var outputDir = new Folder(fileConfig.outputPath);
        if (!outputDir.exists) outputDir.create();
        var outputFile = new File(fileConfig.outputPath + "/" + fileConfig.outputName);

        // TIFF with LZW compression
        var tiffOpts = new TiffSaveOptions();
        tiffOpts.imageCompression = TIFFEncoding.TIFFLZW;
        tiffOpts.layers = false;
        tiffOpts.alphaChannels = false;
        tiffOpts.byteOrder = ByteOrder.IBM;

        // 保存時のカラーモードを取得
        var finalColorMode = getColorModeName(doc.mode);

        doc.saveAs(outputFile, tiffOpts, true, Extension.LOWERCASE);

        // 8. Close
        doc.close(SaveOptions.DONOTSAVECHANGES);

        return {
            fileName: fileName,
            success: true,
            outputPath: outputFile.fsName.replace(/\\/g, "/"),
            colorMode: finalColorMode
        };

    } catch (e) {
        // Close doc if open
        try {
            if (app.documents.length > 0) {
                app.activeDocument.close(SaveOptions.DONOTSAVECHANGES);
            }
        } catch (ex) {}

        return {
            fileName: fileName,
            success: false,
            error: e.message || String(e)
        };
    }
}

/* -----------------------------------------------------
  Layer Operations
 ----------------------------------------------------- */
function unlockAllLayers(doc) {
    // Unlock background layer
    try {
        if (doc.layers.length > 0 && doc.layers[doc.layers.length - 1].isBackgroundLayer) {
            doc.layers[doc.layers.length - 1].isBackgroundLayer = false;
        }
    } catch (e) {}

    // Unlock all locked layers recursively
    unlockRecursive(doc);
}

function unlockRecursive(container) {
    for (var i = 0; i < container.layers.length; i++) {
        var layer = container.layers[i];
        try {
            var originalVisibility = layer.visible;
            layer.allLocked = false;
            layer.pixelsLocked = false;
            layer.positionLocked = false;
            layer.transparentPixelsLocked = false;
            layer.visible = originalVisibility;
        } catch (e) {}
        if (layer.typename === "LayerSet") {
            unlockRecursive(layer);
        }
    }
}

/* -----------------------------------------------------
  Helpers
 ----------------------------------------------------- */
function getExpectedChannelCount(doc) {
    switch (doc.mode) {
        case DocumentMode.RGB: return 3;
        case DocumentMode.GRAYSCALE: return 1;
        case DocumentMode.CMYK: return 4;
        default: return doc.channels.length;
    }
}

function getColorModeName(mode) {
    switch (mode) {
        case DocumentMode.RGB: return "rgb";
        case DocumentMode.GRAYSCALE: return "grayscale";
        case DocumentMode.CMYK: return "cmyk";
        case DocumentMode.LAB: return "lab";
        case DocumentMode.BITMAP: return "bitmap";
        case DocumentMode.INDEXEDCOLOR: return "indexed";
        default: return "unknown";
    }
}

/* -----------------------------------------------------
  JSON Utilities
 ----------------------------------------------------- */
function valueToJSON(val) {
    if (val === null || val === undefined) {
        return "null";
    } else if (typeof val === "string") {
        return '"' + val.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r") + '"';
    } else if (typeof val === "number" || typeof val === "boolean") {
        return String(val);
    } else if (val instanceof Array) {
        return arrayToJSON(val);
    } else if (typeof val === "object") {
        return objectToJSON(val);
    }
    return "null";
}

function arrayToJSON(arr) {
    var json = "[";
    for (var i = 0; i < arr.length; i++) {
        if (i > 0) json += ",";
        json += valueToJSON(arr[i]);
    }
    json += "]";
    return json;
}

function objectToJSON(obj) {
    var json = "{";
    var first = true;
    for (var key in obj) {
        if (obj.hasOwnProperty(key)) {
            if (!first) json += ",";
            first = false;
            json += '"' + key + '":';
            json += valueToJSON(obj[key]);
        }
    }
    json += "}";
    return json;
}

function parseJSON(str) {
    var pos = 0;

    function parseValue() {
        skipWhitespace();
        var ch = str.charAt(pos);
        if (ch === '{') return parseObject();
        if (ch === '[') return parseArray();
        if (ch === '"') return parseString();
        if (ch === 't' || ch === 'f') return parseBoolean();
        if (ch === 'n') return parseNull();
        if (ch === '-' || (ch >= '0' && ch <= '9')) return parseNumber();
        throw new Error("Unexpected character at position " + pos + ": " + ch);
    }

    function skipWhitespace() {
        while (pos < str.length) {
            var ch = str.charAt(pos);
            if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { pos++; } else { break; }
        }
    }

    function parseObject() {
        var obj = {}; pos++; skipWhitespace();
        if (str.charAt(pos) === '}') { pos++; return obj; }
        while (true) {
            skipWhitespace(); var key = parseString(); skipWhitespace();
            if (str.charAt(pos) !== ':') throw new Error("Expected ':' at position " + pos);
            pos++; var value = parseValue(); obj[key] = value; skipWhitespace();
            var ch = str.charAt(pos);
            if (ch === '}') { pos++; return obj; }
            if (ch !== ',') throw new Error("Expected ',' or '}' at position " + pos);
            pos++;
        }
    }

    function parseArray() {
        var arr = []; pos++; skipWhitespace();
        if (str.charAt(pos) === ']') { pos++; return arr; }
        while (true) {
            var value = parseValue(); arr.push(value); skipWhitespace();
            var ch = str.charAt(pos);
            if (ch === ']') { pos++; return arr; }
            if (ch !== ',') throw new Error("Expected ',' or ']' at position " + pos);
            pos++;
        }
    }

    function parseString() {
        pos++; var result = "";
        while (pos < str.length) {
            var ch = str.charAt(pos);
            if (ch === '"') { pos++; return result; }
            if (ch === '\\') {
                pos++; var escaped = str.charAt(pos);
                switch (escaped) {
                    case '"': result += '"'; break; case '\\': result += '\\'; break;
                    case '/': result += '/'; break; case 'b': result += '\b'; break;
                    case 'f': result += '\f'; break; case 'n': result += '\n'; break;
                    case 'r': result += '\r'; break; case 't': result += '\t'; break;
                    case 'u': var hex = str.substr(pos + 1, 4); result += String.fromCharCode(parseInt(hex, 16)); pos += 4; break;
                    default: result += escaped;
                }
                pos++;
            } else { result += ch; pos++; }
        }
        throw new Error("Unterminated string");
    }

    function parseNumber() {
        var start = pos;
        if (str.charAt(pos) === '-') pos++;
        while (pos < str.length && str.charAt(pos) >= '0' && str.charAt(pos) <= '9') pos++;
        if (pos < str.length && str.charAt(pos) === '.') { pos++; while (pos < str.length && str.charAt(pos) >= '0' && str.charAt(pos) <= '9') pos++; }
        if (pos < str.length && (str.charAt(pos) === 'e' || str.charAt(pos) === 'E')) { pos++; if (str.charAt(pos) === '+' || str.charAt(pos) === '-') pos++; while (pos < str.length && str.charAt(pos) >= '0' && str.charAt(pos) <= '9') pos++; }
        return parseFloat(str.substring(start, pos));
    }

    function parseBoolean() {
        if (str.substr(pos, 4) === 'true') { pos += 4; return true; }
        if (str.substr(pos, 5) === 'false') { pos += 5; return false; }
        throw new Error("Invalid boolean at position " + pos);
    }

    function parseNull() {
        if (str.substr(pos, 4) === 'null') { pos += 4; return null; }
        throw new Error("Invalid null at position " + pos);
    }

    return parseValue();
}

/* -----------------------------------------------------
  Execute
 ----------------------------------------------------- */
main();

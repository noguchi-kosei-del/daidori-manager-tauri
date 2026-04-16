// Photoshop JSX Script for JPEG Conversion
// Daidori Manager - PSD to JPEG high-quality conversion

#target photoshop

var originalDialogs = app.displayDialogs;
app.displayDialogs = DialogModes.NO;
app.preferences.rulerUnits = Units.PIXELS;

/* -----------------------------------------------------
  Main Processing
 ----------------------------------------------------- */
function main() {
    var tempFolder = Folder.temp;
    var settingsFile = new File(tempFolder + "/daidori_jpeg_settings.json");

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
    var totalFiles = config.files.length;

    // Progress window
    var progressWin = new Window("palette", "JPEG変換", undefined, { closeButton: false });
    progressWin.orientation = "column";
    progressWin.alignChildren = ["fill", "top"];
    progressWin.spacing = 10;
    progressWin.margins = 20;

    var statusText = progressWin.add("statictext", undefined, "準備中...");
    statusText.preferredSize = [350, 20];

    var progressBar = progressWin.add("progressbar", undefined, 0, totalFiles);
    progressBar.preferredSize = [350, 20];

    var fileText = progressWin.add("statictext", undefined, "");
    fileText.preferredSize = [350, 20];

    var countText = progressWin.add("statictext", undefined, "0 / " + totalFiles);
    countText.alignment = ["center", "center"];

    progressWin.show();

    // Initial heartbeat
    try {
        var pf = new File(tempFolder + "/daidori_jpeg_progress.txt");
        pf.open("w"); pf.write("0/" + String(totalFiles)); pf.close();
    } catch (e_hb0) {}

    for (var i = 0; i < totalFiles; i++) {
        var fileConfig = config.files[i];
        var fileName = decodeURI(new File(fileConfig.path).name);

        // Progress update
        statusText.text = "変換中... (" + (i + 1) + "/" + totalFiles + ")";
        fileText.text = fileName;
        countText.text = (i + 1) + " / " + totalFiles;
        progressBar.value = i;
        progressWin.update();

        var result = processFile(fileConfig, globalSettings);
        results.push(result);

        progressBar.value = i + 1;
        progressWin.update();

        // Heartbeat progress
        try {
            var progressFile = new File(tempFolder + "/daidori_jpeg_progress.txt");
            progressFile.open("w");
            progressFile.write(String(i + 1) + "/" + String(totalFiles));
            progressFile.close();
        } catch (e_hb) {}
    }

    progressWin.close();

    // Write results
    var resultFile = new File(tempFolder + "/daidori_jpeg_results.json");
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

        // 2. Flatten layers
        if (doc.layers.length > 1) {
            doc.flatten();
        }

        // 2.5 Crop (if specified)
        if (fileConfig.cropBounds) {
            var cb = fileConfig.cropBounds;
            if (cb.isMargin) {
                // マージン方式: 各辺からの切り落とし幅
                var docW = doc.width.as("px");
                var docH = doc.height.as("px");
                if (cb.top > 0 || cb.bottom > 0 || cb.left > 0 || cb.right > 0) {
                    doc.crop([
                        new UnitValue(cb.left, "px"),
                        new UnitValue(cb.top, "px"),
                        new UnitValue(docW - cb.right, "px"),
                        new UnitValue(docH - cb.bottom, "px")
                    ]);
                }
            } else {
                // 絶対座標方式
                doc.crop([
                    new UnitValue(cb.left, "px"),
                    new UnitValue(cb.top, "px"),
                    new UnitValue(cb.right, "px"),
                    new UnitValue(cb.bottom, "px")
                ]);
            }
        }

        // 3. Convert to RGB if needed (JPEG requires RGB or Grayscale)
        if (doc.mode !== DocumentMode.RGB && doc.mode !== DocumentMode.GRAYSCALE) {
            doc.changeMode(ChangeMode.RGB);
        }

        // 4. Remove alpha channels
        while (doc.channels.length > getExpectedChannelCount(doc)) {
            doc.channels[doc.channels.length - 1].remove();
        }

        // 5. Save as JPEG
        var outputDir = new Folder(fileConfig.outputPath);
        if (!outputDir.exists) outputDir.create();

        var baseName = fileConfig.outputName.replace(/\.[^.]+$/, "");
        var outputFile = new File(fileConfig.outputPath + "/" + baseName + ".jpg");

        var jpgQuality = globalSettings.jpgQuality || 12;
        // Convert 1-100 scale to 0-12 scale if needed
        if (jpgQuality > 12) {
            jpgQuality = Math.round(jpgQuality / 100 * 12);
        }

        var jpgOpts = new JPEGSaveOptions();
        jpgOpts.quality = jpgQuality;
        jpgOpts.embedColorProfile = true;
        jpgOpts.formatOptions = FormatOptions.STANDARDBASELINE;

        doc.saveAs(outputFile, jpgOpts, true, Extension.LOWERCASE);

        // 6. Close
        doc.close(SaveOptions.DONOTSAVECHANGES);

        return {
            fileName: fileName,
            success: true,
            outputPath: outputFile.fsName.replace(/\\/g, "/")
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

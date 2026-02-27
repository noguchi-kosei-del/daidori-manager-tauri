// Photoshop JSX Script for TIFF Conversion
// Daidori Manager - Based on COMIC-Bridge TIPPY v2.92 processing pipeline

#target photoshop

var originalDialogs = app.displayDialogs;
app.displayDialogs = DialogModes.NO;
app.preferences.rulerUnits = Units.PIXELS;

/* -----------------------------------------------------
  Text Group Names (for consolidation)
 ----------------------------------------------------- */
var TEXT_GROUP_NAMES = ["#text#", "text", "写植", "セリフ", "テキスト", "台詞"];

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
    var totalFiles = config.files.length;

    // プログレスウィンドウを作成
    var progressWin = new Window("palette", "TIFF変換", undefined, { closeButton: false });
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
        var pf = new File(tempFolder + "/daidori_tiff_progress.txt");
        pf.open("w"); pf.write("0/" + String(totalFiles)); pf.close();
    } catch (e_hb0) {}

    for (var i = 0; i < totalFiles; i++) {
        var fileConfig = config.files[i];
        var fileName = decodeURI(new File(fileConfig.path).name);

        // プログレス更新
        statusText.text = "変換中... (" + (i + 1) + "/" + totalFiles + ")";
        fileText.text = fileName;
        countText.text = (i + 1) + " / " + totalFiles;
        progressBar.value = i;
        progressWin.update();

        var result = processFile(fileConfig, globalSettings);
        results.push(result);

        // プログレスバー更新
        progressBar.value = i + 1;
        progressWin.update();

        // Heartbeat progress
        try {
            var progressFile = new File(tempFolder + "/daidori_tiff_progress.txt");
            progressFile.open("w");
            progressFile.write(String(i + 1) + "/" + String(totalFiles));
            progressFile.close();
        } catch (e_hb) {}
    }

    // プログレスウィンドウを閉じる
    progressWin.close();

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

        // 3. Find existing text group for text/background separation
        var textGroup = null;
        for (var gi = 0; gi < doc.layerSets.length; gi++) {
            var gName = doc.layerSets[gi].name;
            for (var gj = 0; gj < TEXT_GROUP_NAMES.length; gj++) {
                if (gName === TEXT_GROUP_NAMES[gj] || gName.toLowerCase() === TEXT_GROUP_NAMES[gj].toLowerCase()) {
                    textGroup = doc.layerSets[gi];
                    break;
                }
            }
            if (textGroup) break;
        }

        // Text layer organization (if enabled)
        if (globalSettings.reorganizeText) {
            if (!textGroup) {
                textGroup = findOrCreateTextGroup(doc);
            }
            if (textGroup) {
                consolidateTextLayers(doc, textGroup);
            }
        }

        // Move text group to top of layer stack
        if (textGroup) {
            try { textGroup.move(doc, ElementPlacement.PLACEATBEGINNING); } catch (e) {}
        }

        // 4. Separate text and background, convert both to smart objects
        var backgroundSO = null;
        var textSO = null;

        if (doc.layers.length > 1 && globalSettings.separateTextAndBackground) {
            var bgLayers = collectNonTextLayers(doc, textGroup);

            // Background: Select all non-text layers -> convert to SO
            if (bgLayers.length > 0) {
                var bgVisibility = [];
                for (var vi = 0; vi < bgLayers.length; vi++) {
                    bgVisibility.push(bgLayers[vi].visible);
                }

                selectLayers(bgLayers);

                for (var vi = 0; vi < bgLayers.length; vi++) {
                    try { bgLayers[vi].visible = bgVisibility[vi]; } catch (e) {}
                }

                backgroundSO = convertToSmartObject();
                if (backgroundSO) backgroundSO.name = "背景";
            }

            // Text: Select text group with all children -> convert to SO
            if (textGroup) {
                try {
                    var textGroupVisible = textGroup.visible;
                    selectLayerWithChildren(textGroup);
                    try { textGroup.visible = textGroupVisible; } catch (e) {}
                    textSO = convertToSmartObject();
                    if (textSO) textSO.name = "テキスト";
                } catch (e) {
                    textSO = null;
                }
            }
        }

        // 5. Rasterize both smart objects
        var textLayer = null;
        if (textSO) {
            try {
                doc.activeLayer = textSO;
                textSO.rasterize(RasterizeType.ENTIRELAYER);
                textLayer = doc.activeLayer;
                textLayer.name = "テキスト";
            } catch (e) {}
        }
        var backgroundLayer = null;
        if (backgroundSO) {
            try {
                doc.activeLayer = backgroundSO;
                backgroundSO.rasterize(RasterizeType.ENTIRELAYER);
                backgroundLayer = doc.activeLayer;
                backgroundLayer.name = "背景";
            } catch (e) {}
        }

        // 6. Color mode conversion
        var targetColorMode = fileConfig.colorMode || globalSettings.colorMode;
        var originalMode = doc.mode;

        if (targetColorMode === "mono" || targetColorMode === "grayscale") {
            // グレースケール設定でも、元がRGBの場合はRGBを維持
            if (originalMode === DocumentMode.RGB) {
                // RGBのまま維持
            } else if (doc.mode !== DocumentMode.GRAYSCALE) {
                doc.changeMode(ChangeMode.GRAYSCALE);
            }
        } else if (targetColorMode === "color" || targetColorMode === "rgb") {
            if (doc.mode !== DocumentMode.RGB) {
                doc.changeMode(ChangeMode.RGB);
            }
        }

        // 7. Re-convert rasterized text to smart object
        var textSOFinal = null;
        if (textLayer) {
            try {
                doc.activeLayer = textLayer;
                textSOFinal = convertToSmartObject();
                if (textSOFinal) textSOFinal.name = "テキスト";
            } catch (e) {}
        }

        // 8. Hide text SO
        if (textSOFinal) {
            try { textSOFinal.visible = false; } catch (e) {}
        }

        // 9. Apply Gaussian blur to background only (if enabled)
        if (fileConfig.applyBlur && fileConfig.blurRadius > 0) {
            if (backgroundLayer) {
                try {
                    doc.activeLayer = backgroundLayer;
                    if (backgroundLayer.allLocked) backgroundLayer.allLocked = false;
                } catch (e) {}
            } else if (doc.layers.length > 0) {
                doc.activeLayer = doc.layers[doc.layers.length - 1];
            }

            if (fileConfig.partialBlur && fileConfig.partialBlur.blurRadius !== undefined) {
                applyPartialBlur(doc, fileConfig);
            } else {
                doc.activeLayer.applyGaussianBlur(fileConfig.blurRadius);
            }
        }

        // 10. Show text SO
        if (textSOFinal) {
            try { textSOFinal.visible = true; } catch (e) {}
        }

        // 11. Final merge
        var layersToMerge = [];
        if (textSOFinal) {
            try { layersToMerge.push(doc.layers.getByName("テキスト")); } catch (e) {}
        }
        if (backgroundLayer) {
            try { layersToMerge.push(doc.layers.getByName("背景")); } catch (e) {}
        }

        if (layersToMerge.length > 0) {
            try {
                selectLayers(layersToMerge);
                convertToSmartObject();
            } catch (e) {}
        }

        // Flatten if not using text separation or if option is set
        if (!globalSettings.separateTextAndBackground || globalSettings.flattenImage) {
            if (doc.layers.length > 1) {
                doc.flatten();
            }
        }

        // 12. Crop (if specified)
        if (!fileConfig.skipCrop && fileConfig.cropBounds) {
            var cb = fileConfig.cropBounds;
            doc.crop([
                new UnitValue(cb.left, "px"),
                new UnitValue(cb.top, "px"),
                new UnitValue(cb.right, "px"),
                new UnitValue(cb.bottom, "px")
            ]);
        }

        // 13. Resize
        if (globalSettings.targetWidth && globalSettings.targetHeight) {
            var targetW = new UnitValue(globalSettings.targetWidth, "px");
            var targetH = new UnitValue(globalSettings.targetHeight, "px");

            // DPI based on color mode
            var targetDPI;
            if (targetColorMode === "mono" || targetColorMode === "grayscale") {
                targetDPI = globalSettings.targetDpiMono || 600;
            } else if (targetColorMode === "color" || targetColorMode === "rgb") {
                targetDPI = globalSettings.targetDpiColor || 350;
            } else {
                targetDPI = globalSettings.targetDpi || doc.resolution;
            }

            doc.resizeImage(targetW, targetH, targetDPI, ResampleMethod.AUTOMATIC);
        }

        // 14. Remove alpha channels
        while (doc.channels.length > getExpectedChannelCount(doc)) {
            doc.channels[doc.channels.length - 1].remove();
        }

        // 15. Save
        var outputDir = new Folder(fileConfig.outputPath);
        if (!outputDir.exists) outputDir.create();
        var outputFile = new File(fileConfig.outputPath + "/" + fileConfig.outputName);
        var baseName = fileConfig.outputName.replace(/\.[^.]+$/, "");

        // 保存時のカラーモードを取得
        var finalColorMode = getColorModeName(doc.mode);

        if (globalSettings.proceedAsTiff !== false) {
            // TIFF with LZW compression
            var tiffOpts = new TiffSaveOptions();
            tiffOpts.imageCompression = TIFFEncoding.TIFFLZW;
            tiffOpts.layers = false;
            tiffOpts.alphaChannels = false;
            tiffOpts.byteOrder = ByteOrder.IBM;
            doc.saveAs(outputFile, tiffOpts, true, Extension.LOWERCASE);
        } else if (globalSettings.outputJpg) {
            // JPG only
            var jpgOpts = new JPEGSaveOptions();
            jpgOpts.quality = 12;
            jpgOpts.embedColorProfile = true;
            jpgOpts.formatOptions = FormatOptions.STANDARDBASELINE;
            var jpgFile = new File(fileConfig.outputPath + "/" + baseName + ".jpg");
            doc.saveAs(jpgFile, jpgOpts, true, Extension.LOWERCASE);
            outputFile = jpgFile;
        } else {
            // PSD
            var psdOpts = new PhotoshopSaveOptions();
            psdOpts.layers = false;
            psdOpts.alphaChannels = false;
            doc.saveAs(outputFile, psdOpts, true, Extension.LOWERCASE);
        }

        // TIFF+JPG: save JPG copy to separate folder
        if (globalSettings.proceedAsTiff !== false && globalSettings.outputJpg && fileConfig.jpgOutputPath) {
            var jpgDir2 = new Folder(fileConfig.jpgOutputPath);
            if (!jpgDir2.exists) jpgDir2.create();
            var jpgFile2 = new File(fileConfig.jpgOutputPath + "/" + baseName + ".jpg");
            var jpgOpts2 = new JPEGSaveOptions();
            jpgOpts2.quality = 12;
            jpgOpts2.embedColorProfile = true;
            jpgOpts2.formatOptions = FormatOptions.STANDARDBASELINE;
            doc.saveAs(jpgFile2, jpgOpts2, true, Extension.LOWERCASE);
        }

        // 16. Close
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
            layer.visible = originalVisibility;
        } catch (e) {}
        if (layer.typename === "LayerSet") {
            unlockRecursive(layer);
        }
    }
}

function findOrCreateTextGroup(doc) {
    // Search existing text group
    for (var i = 0; i < doc.layerSets.length; i++) {
        var groupName = doc.layerSets[i].name;
        for (var j = 0; j < TEXT_GROUP_NAMES.length; j++) {
            if (groupName === TEXT_GROUP_NAMES[j] || groupName.toLowerCase() === TEXT_GROUP_NAMES[j].toLowerCase()) {
                return doc.layerSets[i];
            }
        }
    }

    // Check if any text layers exist
    var hasTextLayers = false;
    checkForTextLayers(doc, function() { hasTextLayers = true; });
    if (!hasTextLayers) return null;

    // Create new text group at top
    var textGroup = doc.layerSets.add();
    textGroup.name = "#text#";
    return textGroup;
}

function checkForTextLayers(container, callback) {
    for (var i = 0; i < container.layers.length; i++) {
        var layer = container.layers[i];
        if (layer.kind === LayerKind.TEXT) {
            callback();
            return;
        }
        if (layer.typename === "LayerSet") {
            checkForTextLayers(layer, callback);
        }
    }
}

function consolidateTextLayers(doc, targetGroup) {
    var layersToMove = [];
    findTextLayersOutside(doc, targetGroup, layersToMove);
    for (var i = 0; i < layersToMove.length; i++) {
        try {
            layersToMove[i].move(targetGroup, ElementPlacement.INSIDE);
        } catch (e) {}
    }
}

function findTextLayersOutside(container, excludeGroup, list) {
    for (var i = 0; i < container.layers.length; i++) {
        var layer = container.layers[i];
        if (excludeGroup && layer.id === excludeGroup.id) continue;
        if (layer.kind === LayerKind.TEXT) {
            list.push(layer);
        } else if (layer.typename === "LayerSet") {
            var allText = true;
            checkAllText(layer, function() { allText = false; });
            if (allText && layer.layers.length > 0) {
                list.push(layer);
            } else {
                findTextLayersOutside(layer, excludeGroup, list);
            }
        }
    }
}

function checkAllText(container, onNonText) {
    for (var i = 0; i < container.layers.length; i++) {
        var layer = container.layers[i];
        if (layer.kind !== LayerKind.TEXT && layer.typename !== "LayerSet") {
            onNonText();
            return;
        }
        if (layer.typename === "LayerSet") {
            checkAllText(layer, onNonText);
        }
    }
}

function collectNonTextLayers(doc, textGroup) {
    var layers = [];
    for (var i = 0; i < doc.layers.length; i++) {
        if (!textGroup || doc.layers[i].id !== textGroup.id) {
            layers.push(doc.layers[i]);
        }
    }
    return layers;
}

function selectLayerWithChildren(layer) {
    var descendants = [];
    function collectDescendants(parent) {
        if (parent.typename === "LayerSet") {
            descendants.push(parent);
            for (var i = 0; i < parent.layers.length; i++) {
                collectDescendants(parent.layers[i]);
            }
        } else {
            descendants.push(parent);
        }
    }
    collectDescendants(layer);
    selectLayers(descendants);
}

function selectLayers(layers) {
    if (layers.length === 0) return;
    var desc = new ActionDescriptor();
    var ref = new ActionReference();
    ref.putIdentifier(charIDToTypeID("Lyr "), layers[0].id);
    desc.putReference(charIDToTypeID("null"), ref);
    desc.putBoolean(stringIDToTypeID("makeVisible"), false);
    executeAction(charIDToTypeID("slct"), desc, DialogModes.NO);

    for (var i = 1; i < layers.length; i++) {
        var addDesc = new ActionDescriptor();
        var addRef = new ActionReference();
        addRef.putIdentifier(charIDToTypeID("Lyr "), layers[i].id);
        addDesc.putReference(charIDToTypeID("null"), addRef);
        addDesc.putEnumerated(
            stringIDToTypeID("selectionModifier"),
            stringIDToTypeID("selectionModifierType"),
            stringIDToTypeID("addToSelection")
        );
        addDesc.putBoolean(stringIDToTypeID("makeVisible"), false);
        executeAction(charIDToTypeID("slct"), addDesc, DialogModes.NO);
    }
}

function convertToSmartObject() {
    try {
        executeAction(stringIDToTypeID("newPlacedLayer"), new ActionDescriptor(), DialogModes.NO);
        return app.activeDocument.activeLayer;
    } catch (e) { return null; }
}

/* -----------------------------------------------------
  Blur Operations
 ----------------------------------------------------- */
function applyPartialBlur(doc, fileConfig) {
    try {
        var activeLayer = doc.activeLayer;
        var pb = fileConfig.partialBlur;
        var defaultBlur = fileConfig.blurRadius;
        var partialBlurRadius = pb.blurRadius;
        var bounds = pb.bounds;

        // 1. Apply default blur to OUTSIDE the selection region
        if (defaultBlur > 0) {
            var selRegion = [
                [bounds.left, bounds.top],
                [bounds.right, bounds.top],
                [bounds.right, bounds.bottom],
                [bounds.left, bounds.bottom]
            ];
            doc.selection.select(selRegion);
            doc.selection.invert();

            if (doc.selection.bounds) {
                activeLayer.applyGaussianBlur(defaultBlur);
            }

            doc.selection.deselect();
        }

        // 2. Apply partial blur to INSIDE the selection region
        if (partialBlurRadius > 0) {
            var selRegion2 = [
                [bounds.left, bounds.top],
                [bounds.right, bounds.top],
                [bounds.right, bounds.bottom],
                [bounds.left, bounds.bottom]
            ];
            doc.selection.select(selRegion2);
            activeLayer.applyGaussianBlur(partialBlurRadius);
            doc.selection.deselect();
        }
    } catch (e) {
        if (fileConfig.blurRadius > 0) {
            try { doc.activeLayer.applyGaussianBlur(fileConfig.blurRadius); } catch (e2) {}
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

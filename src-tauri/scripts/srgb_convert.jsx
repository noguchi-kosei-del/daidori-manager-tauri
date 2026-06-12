// Photoshop JSX Script for sRGB Profile Conversion (19.3 実験)
// Daidori Manager - EPUB生成前のPSD→JPEG中間変換をPhotoshopの
// 「プロファイル変換（Convert to Profile）」で行い、Adobe RGB↔sRGB を
// 厳密に色変換する。ネイティブ(image クレート)は ICC 埋め込みのみで
// 画素の色変換を行わないため、Photoshop 基準の色とずれる可能性がある。
//
// 設定: %TEMP%/daidori_srgb_settings.json
//   { globalSettings: { jpegQuality(1-12), intent("relative"|"perceptual"),
//                       blackPointCompensation(bool), dither(bool),
//                       maxPixels(出力上限ピクセル数, 0=無効) },
//     files: [ { path, outputPath(dir), outputName } ] }
// 進捗: %TEMP%/daidori_srgb_progress.txt  ("X/N")
// 結果: %TEMP%/daidori_srgb_results.json  ({ results: [ {fileName, success, outputPath, error} ] })

#target photoshop

var originalDialogs = app.displayDialogs;
app.displayDialogs = DialogModes.NO;
// アクション再生中のダイアログ（保存オプション/上書き確認等）も抑止する。
// これが無いと、アクション内の Save As 等でダイアログ/エクスプローラーが出る。
var originalPlaybackDialogs = app.playbackDisplayDialogs;
app.playbackDisplayDialogs = DialogModes.NO;
app.preferences.rulerUnits = Units.PIXELS;

var SRGB_PROFILE = "sRGB IEC61966-2.1";

function main() {
    var tempFolder = Folder.temp;
    var settingsFile = new File(tempFolder + "/daidori_srgb_settings.json");

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

    var globalSettings = config.globalSettings || {};
    var results = [];
    var totalFiles = config.files.length;

    // 断ち切り等のアクションセット(.atn)を事前に読み込む（各ページの処理で doAction する）
    if (globalSettings.runAction && globalSettings.actionSetPath) {
        try {
            var atnFile = new File(globalSettings.actionSetPath);
            if (atnFile.exists) {
                app.load(atnFile);
            }
        } catch (eLoad) {
            // 既に読込済み等は無視（doAction時にエラーが出れば各ファイル結果に反映される）
        }
    }

    // プログレスウィンドウ
    var progressWin = new Window("palette", "sRGB変換", undefined, { closeButton: false });
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
    writeProgress(tempFolder, 0, totalFiles);

    for (var i = 0; i < totalFiles; i++) {
        var fileConfig = config.files[i];
        var fileName = decodeURI(new File(fileConfig.path).name);

        statusText.text = "変換中... (" + (i + 1) + "/" + totalFiles + ")";
        fileText.text = fileName;
        countText.text = (i + 1) + " / " + totalFiles;
        progressBar.value = i;
        progressWin.update();

        var result = processFile(fileConfig, globalSettings);
        results.push(result);

        progressBar.value = i + 1;
        progressWin.update();
        writeProgress(tempFolder, i + 1, totalFiles);
    }

    progressWin.close();

    var resultFile = new File(tempFolder + "/daidori_srgb_results.json");
    resultFile.open("w");
    resultFile.encoding = "UTF-8";
    resultFile.write(valueToJSON({ results: results }));
    resultFile.close();

    app.displayDialogs = originalDialogs;
    app.playbackDisplayDialogs = originalPlaybackDialogs;

    // アクション用の中間ファイル置き場を掃除
    try {
        var workFolder = new Folder(Folder.temp + "/daidori_srgb_work");
        if (workFolder.exists) {
            var leftovers = workFolder.getFiles();
            for (var li = 0; li < leftovers.length; li++) {
                try { leftovers[li].remove(); } catch (eLo) {}
            }
            try { workFolder.remove(); } catch (eWf) {}
        }
    } catch (eClean) {}
}

function writeProgress(tempFolder, current, total) {
    try {
        var pf = new File(tempFolder + "/daidori_srgb_progress.txt");
        pf.open("w");
        pf.write(String(current) + "/" + String(total));
        pf.close();
    } catch (e) {}
}

function resolveIntent(name) {
    // 既定は相対的な色域を維持（Relative Colorimetric）。黒点補正は別フラグ。
    if (name === "perceptual") return Intent.PERCEPTUAL;
    if (name === "saturation") return Intent.SATURATION;
    if (name === "absolute") return Intent.ABSOLUTECOLORIMETRIC;
    return Intent.RELATIVECOLORIMETRIC;
}

// ドキュメントが未タグ（カラープロファイルなし）かどうか。
// Photoshop 2026 で ColorProfileType 列挙体が未定義（ReferenceError）になる環境が
// あるため、列挙体を参照せず文字列化して判定する（"ColorProfileType.NONE" を想定）。
function isUntaggedDoc(doc) {
    try {
        return String(doc.colorProfileType).toUpperCase().indexOf("NONE") !== -1;
    } catch (e) {
        return false; // 判定不能時は通常のプロファイル変換経路へ
    }
}

/* -----------------------------------------------------
  Process Single File
 ----------------------------------------------------- */
function processFile(fileConfig, globalSettings) {
    var filePath = fileConfig.path;
    var fileName = decodeURI(new File(filePath).name);
    var workFile = null; // アクション用の中間PSD（保存/閉じる対応）。最後に掃除する

    try {
        var file = new File(filePath);
        if (!file.exists) {
            return { fileName: fileName, success: false, error: "ファイルが存在しません: " + filePath };
        }

        var doc = app.open(file);

        var mode = doc.mode;
        var quality = globalSettings.jpegQuality;
        if (quality === undefined || quality === null) quality = 12;
        var intent = resolveIntent(globalSettings.intent);
        var bpc = (globalSettings.blackPointCompensation === false) ? false : true;
        var dither = (globalSettings.dither === false) ? false : true;
        var maxPixels = globalSettings.maxPixels || 0;

        // 0. 断ち切り等のPhotoshopアクションを実行（切り抜き＝幾何処理を最初に確定）。
        //    レイヤー依存のアクションにも対応するため flatten より前に実行する。
        //    アクションに「保存」「閉じる」が含まれていても処理を引き継げるよう、
        //    実行前にドキュメントへ中間PSDのパスを与えておく:
        //      - アクションの「保存(Ctrl+S)」はこの中間PSDを上書きするのでダイアログが出ない
        //      - アクションがドキュメントを閉じても、中間PSDを再オープンして続行できる
        if (globalSettings.runAction && globalSettings.actionName) {
            // 中間PSDの保存先を用意し、ドキュメントに実パスを与える
            var workFolder = new Folder(Folder.temp + "/daidori_srgb_work");
            if (!workFolder.exists) workFolder.create();
            var workBase = String(fileConfig.outputName).replace(/\.[^.]+$/, "");
            workFile = new File(workFolder.fsName + "/work_" + workBase + ".psd");
            if (workFile.exists) { try { workFile.remove(); } catch (eRmW) {} }
            try {
                var workPsdOpts = new PhotoshopSaveOptions();
                workPsdOpts.embedColorProfile = true;
                workPsdOpts.layers = true;
                workPsdOpts.alphaChannels = true;
                doc.saveAs(workFile, workPsdOpts, true, Extension.LOWERCASE);
            } catch (eSaveWork) {
                // 中間保存に失敗してもアクションは実行する（閉じられた場合のみ復旧不可）
            }

            var docCountBefore = app.documents.length;
            var actionError = null;
            try {
                app.doAction(globalSettings.actionName, globalSettings.actionSet || "");
            } catch (eAct) {
                actionError = "アクション実行に失敗しました（セット: '" +
                    (globalSettings.actionSet || "") + "' / アクション: '" +
                    globalSettings.actionName + "'）: " + (eAct.message || String(eAct));
            }

            if (actionError) {
                // 開いている可能性のあるドキュメントを閉じてからエラー返却
                try {
                    while (app.documents.length > 0) {
                        app.activeDocument.close(SaveOptions.DONOTSAVECHANGES);
                    }
                } catch (eCloseAll) {}
                try { if (workFile && workFile.exists) workFile.remove(); } catch (eRm2) {}
                return { fileName: fileName, success: false, error: actionError };
            }

            if (app.documents.length >= docCountBefore && app.documents.length > 0) {
                // ドキュメントは開いたまま（保存・閉じるを含まないアクション）→ そのまま続行
                doc = app.activeDocument;
            } else {
                // アクションが保存・閉じるを実行 → アクションのSaveで更新された中間PSDを再オープン
                if (!workFile || !workFile.exists) {
                    return {
                        fileName: fileName,
                        success: false,
                        error: "アクションがドキュメントを閉じましたが、中間ファイルが見つかりませんでした。"
                    };
                }
                doc = app.open(workFile);
            }
            mode = doc.mode;
        }

        // 1. レイヤー統合。ブレンドモード等の見た目を確定させてから色変換する
        //    （レイヤーを残したままのプロファイル変換は合成結果が変わることがある）
        doc.flatten();

        // 2. カラーモードを sRGB(RGB) を基準に正規化:
        //    - 未タグRGB    → 慣例どおり sRGB とみなしてタグ付けのみ（画素は変更しない。
        //                      作業スペース依存の変換を避け、ネイティブ経路と意味を揃える）
        //    - RGB/CMYK/Lab → sRGB へ直接プロファイル変換（単一の厳密な変換。
        //                      changeMode 経由だと作業スペースを挟む2段変換になる）
        //    - Indexed/Duotone 等 → 直接変換できないモードは RGB 化してから変換
        //    - Grayscale/Bitmap → sRGB の対象外。EPUB 側でグレースケール(Dot Gain)
        //                          として扱うため、RGB 化せずそのまま JPEG 出力する
        if (mode === DocumentMode.BITMAP) {
            doc.changeMode(ChangeMode.GRAYSCALE);
        } else if (mode === DocumentMode.GRAYSCALE) {
            // グレースケールは変換せず維持
        } else if (mode === DocumentMode.RGB && isUntaggedDoc(doc)) {
            doc.colorProfileName = SRGB_PROFILE;
        } else {
            try {
                // Convert to Profile: 宛先=sRGB, インテント, 黒点補正, ディザ
                doc.convertProfile(SRGB_PROFILE, intent, bpc, dither);
            } catch (eConv) {
                // インデックス/ダブルトーン等、直接変換できないモードはRGB化してから変換
                doc.changeMode(ChangeMode.RGB);
                doc.convertProfile(SRGB_PROFILE, intent, bpc, dither);
            }
        }

        // 3. 最終サイズへ縮小（builder の Apple Books 制約 5.6MP と同じ上限）。
        //    高ビット深度のまま Photoshop で縮小して品質を確保する。
        //    floor で丸めて上限超過を防ぎ、builder 側の再リサイズ・再エンコードを
        //    確実に不要にする（pre_normalized コピー経路）。
        if (maxPixels > 0) {
            var srcW = doc.width.as("px");
            var srcH = doc.height.as("px");
            var px = srcW * srcH;
            if (px > maxPixels) {
                var scale = Math.sqrt(maxPixels / px);
                var newW = Math.max(1, Math.floor(srcW * scale));
                var newH = Math.max(1, Math.floor(srcH * scale));
                doc.resizeImage(UnitValue(newW, "px"), UnitValue(newH, "px"), undefined, ResampleMethod.BICUBICSHARPER);
            }
        }

        // 4. JPEG保存は8bit必須。16/32bitは変換・縮小後（高ビット深度で処理した後）に落とす。
        //    BitsPerChannelType 列挙体が未定義の環境（ColorProfileType と同様）に備えて
        //    文字列判定 + Action Manager（CnvM/Dpth=8）フォールバックで処理する。
        try {
            if (String(doc.bitsPerChannel).toUpperCase().indexOf("EIGHT") === -1) {
                doc.bitsPerChannel = BitsPerChannelType.EIGHT;
            }
        } catch (eDepth) {
            var depthDesc = new ActionDescriptor();
            depthDesc.putInteger(charIDToTypeID("Dpth"), 8);
            executeAction(charIDToTypeID("CnvM"), depthDesc, DialogModes.NO);
        }

        // 5. アルファ除去
        while (doc.channels.length > getExpectedChannelCount(doc)) {
            doc.channels[doc.channels.length - 1].remove();
        }

        var finalColorMode = getColorModeName(doc.mode);

        var outputDir = new Folder(fileConfig.outputPath);
        if (!outputDir.exists) outputDir.create();
        var outputFile = new File(fileConfig.outputPath + "/" + fileConfig.outputName);

        var jpgOpts = new JPEGSaveOptions();
        jpgOpts.quality = quality;
        jpgOpts.embedColorProfile = true; // 変換後の sRGB/グレースケールプロファイルを埋め込む
        jpgOpts.formatOptions = FormatOptions.STANDARDBASELINE;
        doc.saveAs(outputFile, jpgOpts, true, Extension.LOWERCASE);

        doc.close(SaveOptions.DONOTSAVECHANGES);
        // 中間PSDを掃除（閉じた後でないと削除できない）
        try { if (workFile && workFile.exists) workFile.remove(); } catch (eRmDone) {}

        return {
            fileName: fileName,
            success: true,
            outputPath: outputFile.fsName.replace(/\\/g, "/"),
            colorMode: finalColorMode
        };

    } catch (e) {
        try {
            if (app.documents.length > 0) {
                app.activeDocument.close(SaveOptions.DONOTSAVECHANGES);
            }
        } catch (e2) {}
        try { if (workFile && workFile.exists) workFile.remove(); } catch (eRmErr) {}
        return { fileName: fileName, success: false, error: String(e) };
    }
}

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

main();

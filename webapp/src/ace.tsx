import * as React from "react";
import * as pkg from "./package";
import * as core from "./core";
import * as srceditor from "./srceditor"
import * as compiler from "./compiler"
import * as sui from "./sui";
import * as data from "./data";

declare var require: any;
var ace: AceAjax.Ace = require("brace");

var lf = Util.lf

require('brace/mode/typescript');
require('brace/mode/javascript');
require('brace/mode/json');
require('brace/mode/c_cpp');
require('brace/mode/text');
require('brace/mode/xml');
require('brace/mode/markdown');
require('brace/mode/assembly_armthumb');

require('brace/theme/sqlserver');
require('brace/theme/tomorrow_night_bright');

require("brace/ext/language_tools");
require("brace/ext/keybinding_menu");
require("brace/ext/searchbox");



var acequire = (ace as any).acequire;
var Range = acequire("ace/range").Range;

export interface CompletionCache {
    apisInfo: ts.mbit.ApisInfo;
    completionInfo: ts.CompletionInfo;
    posTxt: string;
}

export class AceCompleter extends data.Component<{ parent: Editor; }, {
    visible?: boolean;
    cache?: CompletionCache;
}> {
    // ACE interface
    get activated() { return !!this.state.visible }
    showPopup() {
        this.setState({ visible: true })
    }
    detach() {
        this.setState({ visible: false })
    }
    cancelContextMenu() { }

    queryingFor: string;

    queryCompletionAsync(pos: AceAjax.Position, posTxt: string) {
        if (this.queryingFor == posTxt) return Promise.resolve()

        this.queryingFor = posTxt
        let editor = this.props.parent.editor
        let str = editor.session.getValue()
        let lines = pos.row
        let chars = pos.column
        let i = 0;
        for (; i < str.length; ++i) {
            if (lines == 0) {
                if (chars-- == 0)
                    break;
            } else if (str[i] == '\n') lines--;
        }

        let cache: CompletionCache = {
            apisInfo: null,
            completionInfo: null,
            posTxt: posTxt
        }

        return compiler.workerOpAsync("getCompletions", {
            fileName: this.props.parent.currFile.getTypeScriptName(),
            fileContent: str,
            position: i
        })
            .then(compl => { cache.completionInfo = compl })
            .then(() => compiler.getApisInfoAsync())
            .then(info => { cache.apisInfo = info })
            .then(() => this.setState({ cache: cache }))
    }

    fetchCompletionInfo(textPos: AceAjax.Position) {
        let posTxt = this.props.parent.currFile.getName() + ":" + textPos.row + ":" + textPos.column
        let cache = this.state.cache
        if (!cache || cache.posTxt != posTxt) {
            this.queryCompletionAsync(textPos, posTxt).done();
            return null;
        }

        return cache.completionInfo.entries;
    }

    // React interface
    componentDidMount() {
        this.props.parent.completer = this;
    }
    renderCore() {
        let editor = this.props.parent.editor
        if (!editor || !this.state.visible) return null

        let mode = editor.session.getMode();
        if (mode.$id != "ace/mode/typescript") return null;

        let renderer: any = editor.renderer

        let textPos = editor.getCursorPosition();
        let line = editor.session.getLine(textPos.row);
        let pref = line.slice(0, textPos.column)
        let m = /(\w*)$/.exec(pref)
        pref = m ? m[1].toLowerCase() : ""

        textPos.column -= pref.length

        let pos = renderer.$cursorLayer.getPixelPosition(textPos, false);
        pos.top -= renderer.scrollTop;
        pos.left -= renderer.scrollLeft;
        pos.top += renderer.layerConfig.lineHeight;
        pos.left += renderer.gutterWidth;

        let info = this.fetchCompletionInfo(textPos);

        if (!info) return null; // or Loading... ?

        info = info.filter(e => Util.startsWith(e.name.toLowerCase(), pref))
        
        let prefRange = new Range(textPos.row, textPos.column, textPos.row, textPos.column + pref.length);

        return (
            <div className='ui vertical menu completer' style={{ left: pos.left + "px", top: pos.top + "px" }}>
                {info.map(e => <sui.Item class='link' key={e.name} text={e.name} value={e.name} onClick={() => {
                    editor.session.replace(prefRange, e.name);
                    this.detach()
                }} />) }
            </div>
        )
    }
}

export class Editor extends srceditor.Editor {
    editor: AceAjax.Editor;
    currFile: pkg.File;
    completer: AceCompleter;

    menu() {
        return (
            <div className="item">
                <sui.DropdownMenu class="button floating" text={lf("Edit") } icon="edit">
                    <sui.Item icon="find" text={lf("Find") } onClick={() => this.editor.execCommand("find") } />
                    <sui.Item icon="wizard" text={lf("Replace") } onClick={() => this.editor.execCommand("replace") } />
                    <sui.Item icon="help circle" text={lf("Keyboard shortcuts") } onClick={() => this.editor.execCommand("showKeyboardShortcuts") } />
                </sui.DropdownMenu>
            </div>
        )
    }

    display() {
        return (
            <div>
                <div className='full-abs' id='aceEditorInner' />
                <AceCompleter parent={this} />
            </div>
        )
    }

    prepare() {
        this.editor = ace.edit("aceEditorInner");
        (this.editor as any).completer = this.completer;

        let langTools = acequire("ace/ext/language_tools");

        let tsCompleter = {
            getCompletions: (editor: AceAjax.Editor, session: AceAjax.IEditSession, pos: AceAjax.Position, prefix: string, callback: any) => {
                let mode = session.getMode();
                if ((mode as any).$id == "ace/mode/typescript") {
                    let str = session.getValue()
                    let lines = pos.row
                    let chars = pos.column
                    let i = 0;
                    for (; i < str.length; ++i) {
                        if (lines == 0) {
                            if (chars-- == 0)
                                break;
                        } else if (str[i] == '\n') lines--;
                    }

                    compiler.workerOpAsync("getCompletions", {
                        fileName: this.currFile.getTypeScriptName(),
                        fileContent: str,
                        position: i
                    }).done((compl: ts.CompletionInfo) => {
                        let entries = compl.entries.map(e => {
                            return {
                                name: e.name,
                                value: e.name,
                                meta: e.kind
                            }
                        })
                        callback(null, entries)
                    })
                } else {
                    langTools.textCompleter(editor, session, pos, prefix, callback)
                }
            }
        }

        langTools.setCompleters([tsCompleter, langTools.keyWordCompleter]);

        this.editor.setOptions({
            enableBasicAutocompletion: true,
            // enableSnippets: true,
            enableLiveAutocompletion: true
        });

        this.editor.commands.on("exec", function(e: any) {
            console.info("beforeExec", e.command.name)
        });

        this.editor.commands.on("afterExec", function(e: any) {
            console.info("afterExec", e.command.name)
            if (e.command.name == "insertstring" && e.args == ".") {
                //var all = e.editor.completers;
                //e.editor.completers = [completers];
                e.editor.execCommand("startAutocomplete");
                //e.editor.completers = all;
            }
        });

        this.editor.commands.addCommand({
            name: "showKeyboardShortcuts",
            bindKey: { win: "Ctrl-Alt-h", mac: "Command-Alt-h" },
            exec: () => {
                let module = acequire("ace/ext/keybinding_menu")
                module.init(this.editor);
                (this.editor as any).showKeyboardShortcuts()
            }
        })

        let sess = this.editor.getSession()
        sess.setNewLineMode("unix");
        sess.setTabSize(4);
        sess.setUseSoftTabs(true);
        this.editor.$blockScrolling = Infinity;

        sess.on("change", () => {
            if (this.lastSet != null) {
                this.lastSet = null
            } else {
                this.changeCallback();
            }
        })

        this.isReady = true
    }

    getId() {
        return "aceEditor"
    }

    setTheme(theme: srceditor.Theme) {
        let th = theme.inverted ? 'ace/theme/tomorrow_night_bright' : 'ace/theme/sqlserver'
        if (this.editor.getTheme() != th) {
            this.editor.setTheme(th)
        }
        this.editor.setFontSize(theme.fontSize)
    }

    getViewState() {
        return this.editor.getCursorPosition()
    }

    getCurrentSource() {
        return this.editor.getValue()
    }

    acceptsFile(file: pkg.File) {
        return true
    }

    private lastSet: string;
    private setValue(v: string) {
        this.lastSet = v;
        this.editor.setValue(v, -1)
    }

    loadFile(file: pkg.File) {
        let ext = file.getExtension()
        let modeMap: any = {
            "cpp": "c_cpp",
            "json": "json",
            "md": "markdown",
            "ts": "typescript",
            "js": "javascript",
            "blocks": "xml",
            "asm": "assembly_armthumb"
        }
        let mode = "text"
        if (modeMap.hasOwnProperty(ext)) mode = modeMap[ext]
        let sess = this.editor.getSession()
        sess.setMode('ace/mode/' + mode);
        this.editor.setReadOnly(file.isReadonly())
        this.currFile = file;
        this.setValue(file.content)
        this.setDiagnostics(file)
    }

    setDiagnostics(file: pkg.File) {
        let sess = this.editor.getSession();
        Object.keys(sess.getMarkers(true) || {}).forEach(m => sess.removeMarker(parseInt(m)))
        sess.clearAnnotations()
        let ann: AceAjax.Annotation[] = []
        if (file.diagnostics)
            for (let diagnostic of file.diagnostics) {
                const p0 = ts.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start);
                const p1 = ts.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start + diagnostic.length)
                ann.push({
                    row: p0.line,
                    column: p0.character,
                    text: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
                    type: "error"
                })
                sess.addMarker(new Range(p0.line, p0.character, p1.line, p1.character),
                    "ace_error-marker", "ts-error", true)
            }
        sess.setAnnotations(ann)
    }

    setViewState(pos: AceAjax.Position) {
        this.editor.moveCursorToPosition(pos)
        this.editor.scrollToLine(pos.row - 1, true, false, () => { })
    }
}

import {
  Disposable,
  Webview,
  WebviewPanel,
  window,
  Uri,
  ViewColumn,
} from "vscode";
import * as vscode from "vscode";
import { getNonce, getUri } from "../../utils/utils";
import * as fs from "fs";
import * as ejs from "ejs";
import { ConfigurationsChange } from "../../utils/events";
import { URI } from "vscode-languageclient";
import * as readline from "readline";

import os from "node:os";
const homeDirectory = os.homedir();
export default function untildify(pathWithTilde: string) {
  if (typeof pathWithTilde !== "string") {
    throw new TypeError(`Expected a string, got ${typeof pathWithTilde}`);
  }

  return homeDirectory
    ? pathWithTilde.replace(/^~(?=$|\/|\\)/, homeDirectory)
    : pathWithTilde;
}

export class ConfigurationWebView {
  public static panels: Map<number, ConfigurationWebView> | undefined;
  public static readonly viewType = "odooConfiguration";
  public configId: number | undefined;
  private readonly _panel: WebviewPanel;
  private _disposables: Disposable[] = [];
  private readonly _context: vscode.ExtensionContext;
  private addons: Array<String> = [];

  private constructor(
    panel: WebviewPanel,
    configId: number,
    context: vscode.ExtensionContext
  ) {
    this._panel = panel;
    this._context = context;
    this.configId = configId;
    //this.addons = context.globalState.get("odoo-update-restart-on-saveconfigurations")[configId]["addons"];
    this._panel.onDidDispose(this.dispose, this, this._disposables);
    this._panel.webview.html = this._getWebviewContent(
      this._panel.webview,
      context.extensionUri
    );
    this._setWebviewMessageListener(this._panel.webview);
  }
  public dispose() {
    if (
      ConfigurationWebView.panels &&
      this.configId !== undefined &&
      this.configId !== null
    ) {
      ConfigurationWebView.panels.delete(this.configId);
    }
    // Dispose of the current webview panel
    this._panel.dispose();

    // Dispose of all disposables (i.e. commands) for the current webview panel
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
  private getConfigurations(attr: string) {
    return (
      (this._context.globalState.get(
        `odoo-update-restart-on-save.${attr}`
      ) as any) ?? null
    );
  }
  private _getWebviewContent(webview: Webview, extensionUri: Uri) {
    const webviewElementsUri = getUri(webview, extensionUri, [
      "node_modules",
      "@bendera",
      "vscode-webview-elements",
      "dist",
      "bundled.js",
    ]);
    const htmlPath = getUri(webview, extensionUri, [
      "src",
      "views",
      "configurations",
      "configurationWebView.html",
    ]);
    const styleUri = getUri(webview, extensionUri, [
      "src",
      "views",
      "configurations",
      "style.css",
    ]);
    const codiconStyleUri = getUri(webview, extensionUri, [
      "node_modules",
      "@vscode",
      "codicons",
      "dist",
      "codicon.css",
    ]);
    const mainUri = getUri(webview, extensionUri, [
      "src",
      "views",
      "configurations",
      "configurationWebView.js",
    ]);
    const config = this.getConfigurations("configurations");
    const htmlFile = fs.readFileSync(htmlPath.fsPath, "utf-8");
    const nonce = getNonce();
    const configsVersion = this.getConfigurations("configsVersion");

    let data = {
      webviewElementsUri: webviewElementsUri,
      styleUri: styleUri,
      codiconStyleUri: codiconStyleUri,
      mainUri: mainUri,
      config: config,
      cspSource: webview.cspSource,
      nonce: nonce,
      odooVersion: configsVersion,
    };
    return ejs.render(htmlFile, data);
  }
  public static render(context: vscode.ExtensionContext, configId: number) {
    if (!ConfigurationWebView.panels) {
      ConfigurationWebView.panels = new Map();
    }
    if (ConfigurationWebView.panels.has(configId)) {
      // If a webview panel already exists for a config ID, reveal it
      const panel = ConfigurationWebView.panels.get(configId)?._panel;
      if (panel) {
        panel.reveal(vscode.ViewColumn.One);
      }
    } else {
      // If a webview panel does not already exist create and show a new one
      const configName = (
        context.globalState.get(
          "odoo-update-restart-on-save.configurations"
        ) as any
      )["name"];
      const panel = window.createWebviewPanel(
        // Panel view type
        "showConfigurationPanel",
        // Panel title
        `Odoo: ${configName}`,
        // The editor column the panel should be displayed in
        vscode.ViewColumn.One,
        // Extra panel configurations
        {
          // Enable JavaScript in the webview
          enableScripts: true,
          retainContextWhenHidden: true,
        }
      );
      ConfigurationWebView.panels.set(
        configId,
        new ConfigurationWebView(panel, configId, context)
      );
    }
  }
  private _saveConfig(
    config: any,
    odooPath: string,
    name: string,
    addons: Array<String>,
    pythonPath: string = "python3"
  ): void {
    let changes = [];
    let oldAddons = config["addons"];

    if (config["odooPath"] !== odooPath) {
      changes.push("odooPath");
    }

    if (config["name"] !== name) {
      changes.push("name");
    }

    if (config["pythonPath"] !== pythonPath) {
      changes.push("pythonPath");
    }

    if (oldAddons.length !== addons.length) {
      changes.push("addons");
    } else {
      oldAddons.sort();
      addons.sort();
      for (let i = 0; i < oldAddons.length; i++) {
        if (oldAddons[i] !== addons[i]) {
          changes.push("addons");
          break;
        }
      }
    }

    config = {
      id: this.configId,
      name: name,
      odooPath: untildify(odooPath),
      addons: addons,
      pythonPath: untildify(pythonPath),
    };
    this._context.globalState.update(
      "odoo-update-restart-on-save.configurations",
      config
    );
    ConfigurationsChange.fire(changes);

    if (changes.includes("name")) {
      this._updateWebviewTitle(this._panel, name);
    }
    this._createLaunchJsonFile(config);
  }
  private async _createLaunchJsonFile(config: any) {
    const version = this.getConfigurations("configsVersion");
    const launchConfig = {
      version: "0.2.0",
      configurations: [
        {
          name: `Odoo - ${version}`,
          type: "python",
          request: "launch",
          justMyCode: true,
          stopOnEntry: false,
          python: config["pythonPath"],
          console: "integratedTerminal",
          program: "${workspaceRoot}\\odoo-bin",
          args: [
            "--config=${workspaceRoot}\\odoo.conf",
            `--database=${config["name"]}`,
          ],
          cwd: "${workspaceRoot}",
        },
      ],
    };

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
      const launchJsonPath = vscode.Uri.joinPath(
        workspaceFolder.uri,
        ".vscode",
        "launch.json"
      );
      const launchJsonContent = JSON.stringify(launchConfig, null, 2);

      try {
        await vscode.workspace.fs.writeFile(
          launchJsonPath,
          Buffer.from(launchJsonContent)
        );
        vscode.window.showInformationMessage(
          "launch.json file created successfully."
        );
      } catch (error) {
        vscode.window.showErrorMessage("Failed to create launch.json file.");
      }
    } else {
      vscode.window.showErrorMessage("No workspace folder found.");
    }
  }
  private _updateWebviewTitle(panel: WebviewPanel, title: string) {
    panel.title = `Odoo: ${title}`;
  }
  private _setWebviewMessageListener(webview: Webview) {
    webview.onDidReceiveMessage(
      (message: any) => {
        const command = message.command;
        const config: any = this.getConfigurations("configurations");

        switch (command) {
          case "save_config":
            const odooPath = message.odooPath;
            const name = message.name;
            const addons = message.addons;
            const pythonPath = message.pythonPath;
            this._saveConfig(config, odooPath, name, addons, pythonPath);
            break;
          case "view_ready":
            webview.postMessage({
              command: "render_addons",
              addons: config["addons"],
            });
            break;
          case "open_odoo_folder":
            const odooFolderOptions: vscode.OpenDialogOptions = {
              title: "Add Odoo folder",
              openLabel: "Add folder",
              canSelectMany: false,
              canSelectFiles: false,
              canSelectFolders: true,
            };
            window.showOpenDialog(odooFolderOptions).then((fileUri) => {
              if (fileUri && fileUri[0]) {
                const odooFolderPath = fileUri[0].fsPath;
                webview.postMessage({
                  command: "update_path",
                  path: odooFolderPath,
                });
                this._getOdooVersion(odooFolderPath, webview);
              }
            });
            break;
          case "add_addons_folder":
            const addonsFolderOptions: vscode.OpenDialogOptions = {
              title: "Add addons folder",
              openLabel: "Add folder",
              canSelectMany: false,
              canSelectFiles: false,
              canSelectFolders: true,
            };
            window.showOpenDialog(addonsFolderOptions).then((fileUri) => {
              if (fileUri && fileUri[0]) {
                this.addons = [...this.addons, fileUri[0].fsPath];
                webview.postMessage({
                  command: "render_addons",
                  addons: this.addons,
                });
              }
            });
            break;
          case "delete_addons_folder":
            this.addons = message.addons;
            break;

          case "open_python_path":
            const pythonPathOptions: vscode.OpenDialogOptions = {
              title: "Add Python path",
              openLabel: "Add path",
              canSelectMany: false,
              canSelectFiles: false,
              canSelectFolders: false,
            };
            window.showOpenDialog(pythonPathOptions).then((fileUri) => {
              if (fileUri && fileUri[0]) {
                const odooPythonPath = fileUri[0].fsPath;
                webview.postMessage({
                  command: "update_python_path",
                  pythonPath: odooPythonPath,
                });
              }
            });
            break;
          case "update_version":
            this._getOdooVersion(message.odooPath, webview);
            break;
        }
      },
      undefined,
      this._disposables
    );
  }
  private _getOdooVersion(odooPath: URI, webview: Webview) {
    let versionString: any = null;
    const releasePath = untildify(odooPath) + "/odoo/release.py";
    if (fs.existsSync(releasePath)) {
      const rl = readline.createInterface({
        input: fs.createReadStream(releasePath),
        crlfDelay: Infinity,
      });

      rl.on("line", (line) => {
        if (line.startsWith("version_info")) {
          versionString = line;
          rl.close();
        }
      });
      rl.on("close", () => {
        // Folder is invalid if we don't find any version info
        if (!versionString) {
          this._context.globalState.update(
            "odoo-update-restart-on-save.configsVersion",
            null
          );
          webview.postMessage({
            command: "update_config_folder_validity",
            version: null,
          });
        } else {
          // Folder is valid if a version was found
          const versionRegEx = /\(([^)]+)\)/; // Regex to obtain the info in the parentheses
          const versionMatch = versionRegEx.exec(versionString);
          const versionArray = versionMatch ? versionMatch[1].split(", ") : [];
          const version =
            `${versionArray[0]}.${versionArray[1]}.${versionArray[2]}` +
            (versionArray[3] == "FINAL"
              ? ""
              : ` ${versionArray[3]}${versionArray[4]}`);
          this._context.globalState.update(
            "odoo-update-restart-on-save.configsVersion",
            version
          );
          webview.postMessage({
            command: "update_config_folder_validity",
            version: version,
          });
        }
      });
    } else {
      // Folder is invalid if odoo/release.py was never found
      this._context.globalState.update(
        "odoo-update-restart-on-save.configsVersion",
        null
      );
      webview.postMessage({
        command: "update_config_folder_validity",
        version: null,
      });
    }
  }
}

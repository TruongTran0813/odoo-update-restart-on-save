import * as vscode from "vscode";
import { RunOnSaveExtExtension } from "./runner";
import { ConfigurationWebView } from "./views/configurations/configurationWebView";
import {
  commands,
  ExtensionContext,
  ExtensionMode,
  QuickPickItem,
  StatusBarAlignment,
  StatusBarItem,
  ThemeIcon,
  workspace,
  window,
  QuickPickItemKind,
  TextDocument,
  OutputChannel,
  Uri,
} from "vscode";
import { getCurrentConfig } from "./utils/utils";
import * as fs from "fs";
import * as path from "path";

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  integer,
} from "vscode-languageclient/node";
import { ConfigurationsChange } from "./utils/events";

let odooStatusBar: StatusBarItem;
let isLoading: boolean;
async function checkOdooPath(context: ExtensionContext) {
  let currentConfig = getCurrentConfig(context);
  if (!currentConfig) return;
  let odooFound = currentConfig
    ? workspace.getWorkspaceFolder(Uri.file(currentConfig.odooPath))
    : true;
  if (!odooFound) {
    let invalidPath = false;
    if (workspace.workspaceFolders) {
      for (const f of workspace.workspaceFolders) {
        if (
          fs.existsSync(Uri.joinPath(f.uri, "odoo-bin").fsPath) ||
          fs.existsSync(
            Uri.joinPath(Uri.joinPath(f.uri, "odoo"), "odoo-bin").fsPath
          )
        ) {
          invalidPath = true;
          break;
        }
      }
    }
    if (invalidPath) {
      const selection = await window.showWarningMessage(
        `The Odoo configuration selected does not match the odoo path in the workspace. Would you like to change it?`,
        "Update current configuration",
        "Ignore"
      );
      switch (selection) {
        case "Update current configuration":
          ConfigurationWebView.render(context, currentConfig.id);
          break;
      }
    }
  }

  const binPath = path.join(currentConfig.odooPath, "odoo-bin");
  const configPath = path.join(currentConfig.odooPath, "odoo.conf");
  const checkBinFile = fs.existsSync(binPath);
  const checkConfigFile = fs.existsSync(configPath);
  if (!checkBinFile || !checkConfigFile) {
    vscode.window
      .showErrorMessage(
        "The odoo-bin file or the odoo-conf file was not found in Odoo folder path.",
        "Update current configuration",
        "Ignore"
      )
      .then((selection) => {
        if (selection === "Update current configuration") {
          ConfigurationWebView.render(context, currentConfig.id);
        }
      });
  }
}
function setStatusConfig(context: ExtensionContext, statusItem: StatusBarItem) {
  const config = getCurrentConfig(context);
  let text = config ? `Odoo (${config["name"]})` : `Odoo (Disabled)`;
  statusItem.text = isLoading ? "$(loading~spin) " + text : text;
}
async function checkAddons(context: ExtensionContext) {
  let files = await workspace.findFiles("**/__manifest__.py");
  let currentConfig = getCurrentConfig(context);
  if (currentConfig) {
    let missingFiles = files.filter((file) => {
      return !(
        currentConfig.addons.some((addon: any) =>
          file.fsPath.startsWith(addon)
        ) || file.fsPath.startsWith(currentConfig.odooPath)
      );
    });
    let missingPaths = [
      ...new Set(
        missingFiles.map((file) => {
          let filePath = file.fsPath.split(path.sep);
          return filePath.slice(0, filePath.length - 2).join(path.sep);
        })
      ),
    ];
    if (missingPaths.length > 0) {
      const selection = await window.showWarningMessage(
        `We detected addon paths that weren't added in the current configuration. Would you like to add them?`,
        "Update current configuration",
        "Ignore"
      );
      switch (selection) {
        case "Update current configuration":
          ConfigurationWebView.render(context, currentConfig.id);
          break;
      }
    }
  }
}
function initializeSubscriptions(
  context: ExtensionContext,
  extension: RunOnSaveExtExtension
): void {
  odooStatusBar = window.createStatusBarItem(StatusBarAlignment.Left, 100);
  odooStatusBar.tooltip = "Odoo Update & Restart on Save @TruongTran0813";
  setStatusConfig(context, odooStatusBar);
  odooStatusBar.show();
  const currentConfig = getCurrentConfig(context);
  currentConfig && extension.loadConfig();
  odooStatusBar.command = `odoo-update-restart-on-save.${
    currentConfig ? "openConfiguration" : "addConfiguration"
  }`;
  const configId = 0;
  context.subscriptions.push(odooStatusBar);
  context.subscriptions.push(
    commands.registerCommand(
      "odoo-update-restart-on-save.addConfiguration",
      async () => {
        await context.globalState.update(
          "odoo-update-restart-on-save.configurations",
          {
            id: configId,
            name: `New Configuration ${configId}`,
            odooPath: "",
            addons: [],
            pythonPath: "python3",
          }
        );

        ConfigurationsChange.fire(null);
        ConfigurationWebView.render(context, configId);
      }
    )
  );
  context.subscriptions.push(
    commands.registerCommand(
      "odoo-update-restart-on-save.openConfiguration",
      async () => {
        ConfigurationWebView.render(context, currentConfig.id ?? configId);
      }
    )
  );

  context.subscriptions.push(
    ConfigurationsChange.event((changes: any) => {
      try {
        setStatusConfig(context, odooStatusBar);
        extension.loadConfig();
        if (
          changes &&
          (changes.includes("odooPath") || changes.includes("addons"))
        ) {
          checkOdooPath(context);
          checkAddons(context);
        }
      } catch (error) {}
    })
  );
  context.subscriptions.push(
    commands.registerCommand(
      "odoo-update-restart-on-save.updateModule",
      (e: vscode.Uri) => {
        extension.updateModule(e);
      }
    )
  );
}

export function activate(context: vscode.ExtensionContext) {
  const extension = new RunOnSaveExtExtension(context);
  extension.showOutputMessage();
  checkOdooPath(context);
  initializeSubscriptions(context, extension);

  vscode.workspace.onDidSaveTextDocument((document: vscode.TextDocument) => {
    extension.runCommands(document);
  });
}

// This method is called when your extension is deactivated
export function deactivate() {}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AzureTreeItem, callWithTelemetryAndErrorHandling, IActionContext, IErrorHandlerContext, ITreeItemPickerContext, registerCommand, registerErrorHandler, registerEvent } from "vscode-azureextensionui";
import { Experience, MongoExperience } from '../AzureDBExperiences';
import { ext } from "../extensionVariables";
import { AttachedAccountSuffix } from '../tree/AttachedAccountsTreeItem';
import * as vscodeUtil from '../utils/vscodeUtils';
import { MongoConnectError } from './connectToMongoClient';
import { MongoDBLanguageClient } from "./languageClient";
import { executeAllCommandsFromActiveEditor, executeCommandFromActiveEditor, getAllErrorsFromTextDocument } from "./MongoScrapbook";
import { MongoCodeLensProvider } from "./services/MongoCodeLensProvider";
import { setConnectedNode } from "./setConnectedNode";
import { MongoAccountTreeItem } from "./tree/MongoAccountTreeItem";
import { MongoCollectionTreeItem } from "./tree/MongoCollectionTreeItem";
import { MongoDatabaseTreeItem } from "./tree/MongoDatabaseTreeItem";
import { MongoDocumentTreeItem } from "./tree/MongoDocumentTreeItem";

const connectedMongoKey: string = 'ms-azuretools.vscode-cosmosdb.connectedDB';
let diagnosticsCollection: vscode.DiagnosticCollection;
const mongoLanguageId: string = 'mongo';

export function registerMongoCommands(): MongoCodeLensProvider {
    const languageClient: MongoDBLanguageClient = new MongoDBLanguageClient();

    const codeLensProvider = new MongoCodeLensProvider();
    ext.context.subscriptions.push(vscode.languages.registerCodeLensProvider(mongoLanguageId, codeLensProvider));

    diagnosticsCollection = vscode.languages.createDiagnosticCollection('cosmosDB.mongo');
    ext.context.subscriptions.push(diagnosticsCollection);

    setUpErrorReporting();

    const loadPersistedMongoDBTask: Promise<void> = loadPersistedMongoDB(languageClient, codeLensProvider);

    registerCommand('cosmosDB.createMongoDatabase', async (context: IActionContext, node?: MongoAccountTreeItem) => {
        if (!node) {
            node = <MongoAccountTreeItem>await ext.tree.showTreeItemPicker([MongoAccountTreeItem.contextValue, MongoAccountTreeItem.contextValue + AttachedAccountSuffix], context);
        }
        const databaseNode = <MongoDatabaseTreeItem>await node.createChild(context);
        await databaseNode.createChild(context);

        await vscode.commands.executeCommand('cosmosDB.connectMongoDB', databaseNode);
    });
    registerCommand('cosmosDB.createMongoCollection', async (context: IActionContext, node?: MongoDatabaseTreeItem) => {
        if (!node) {
            node = <MongoDatabaseTreeItem>await ext.tree.showTreeItemPicker(MongoDatabaseTreeItem.contextValue, context);
        }
        const collectionNode = await node.createChild(context);
        await vscode.commands.executeCommand('cosmosDB.connectMongoDB', collectionNode.parent);
    });
    registerCommand('cosmosDB.createMongoDocument', async (context: IActionContext, node?: MongoCollectionTreeItem) => {
        if (!node) {
            node = <MongoCollectionTreeItem>await ext.tree.showTreeItemPicker(MongoCollectionTreeItem.contextValue, context);
        }
        const documentNode = await node.createChild(context);
        await vscode.commands.executeCommand("cosmosDB.openDocument", documentNode);
    });
    registerCommand('cosmosDB.connectMongoDB', async (context: IActionContext, node?: MongoDatabaseTreeItem) => {
        if (!node) {
            // Include defaultExperience in the context to prevent https://github.com/microsoft/vscode-cosmosdb/issues/1517
            const experienceContext: ITreeItemPickerContext & { defaultExperience?: Experience } = { ...context, defaultExperience: MongoExperience };
            node = <MongoDatabaseTreeItem>await ext.tree.showTreeItemPicker(MongoDatabaseTreeItem.contextValue, experienceContext);
        }

        const oldNodeId: string | undefined = ext.connectedMongoDB && ext.connectedMongoDB.fullId;
        await languageClient.connect(node.connectionString, node.databaseName);
        void ext.context.globalState.update(connectedMongoKey, node.fullId);
        setConnectedNode(node, codeLensProvider);
        await node.refresh(context);

        if (oldNodeId) {
            // We have to use findTreeItem to get the instance of the old node that's being displayed in the ext.tree. Our specific instance might have been out-of-date
            const oldNode: AzureTreeItem | undefined = await ext.tree.findTreeItem(oldNodeId, context);
            if (oldNode) {
                await oldNode.refresh(context);
            }
        }
    });
    registerCommand('cosmosDB.deleteMongoDB', async (context: IActionContext, node?: MongoDatabaseTreeItem) => {
        const suppressCreateContext: ITreeItemPickerContext = context;
        suppressCreateContext.suppressCreatePick = true;
        if (!node) {
            node = <MongoDatabaseTreeItem>await ext.tree.showTreeItemPicker(MongoDatabaseTreeItem.contextValue, context);
        }
        await node.deleteTreeItem(context);
        if (ext.connectedMongoDB && ext.connectedMongoDB.fullId === node.fullId) {
            setConnectedNode(undefined, codeLensProvider);
            void ext.context.globalState.update(connectedMongoKey, undefined);
            // Temporary workaround for https://github.com/microsoft/vscode-cosmosdb/issues/1754
            void languageClient.disconnect();
        }
    });
    registerCommand('cosmosDB.deleteMongoCollection', async (context: IActionContext, node?: MongoCollectionTreeItem) => {
        const suppressCreateContext: ITreeItemPickerContext = context;
        suppressCreateContext.suppressCreatePick = true;
        if (!node) {
            node = <MongoCollectionTreeItem>await ext.tree.showTreeItemPicker(MongoCollectionTreeItem.contextValue, context);
        }
        await node.deleteTreeItem(context);
    });
    registerCommand('cosmosDB.deleteMongoDocument', async (context: IActionContext, node?: MongoDocumentTreeItem) => {
        const suppressCreateContext: ITreeItemPickerContext = context;
        suppressCreateContext.suppressCreatePick = true;
        if (!node) {
            node = <MongoDocumentTreeItem>await ext.tree.showTreeItemPicker(MongoDocumentTreeItem.contextValue, context);
        }
        await node.deleteTreeItem(context);
    });
    registerCommand('cosmosDB.openCollection', async (context: IActionContext, node?: MongoCollectionTreeItem) => {
        if (!node) {
            node = <MongoCollectionTreeItem>await ext.tree.showTreeItemPicker(MongoCollectionTreeItem.contextValue, context);
        }
        await ext.fileSystem.showTextDocument(node);
    });
    registerCommand('cosmosDB.launchMongoShell', launchMongoShell);
    registerCommand('cosmosDB.newMongoScrapbook', async () => await vscodeUtil.showNewFile('', 'Scrapbook', '.mongo'));
    registerCommand('cosmosDB.executeMongoCommand', async (context: IActionContext, position?: vscode.Position) => {
        await loadPersistedMongoDBTask;
        await executeCommandFromActiveEditor(context, position);
    });
    registerCommand('cosmosDB.executeAllMongoCommands', async (context: IActionContext) => {
        await loadPersistedMongoDBTask;
        await executeAllCommandsFromActiveEditor(context);
    });

    return codeLensProvider;
}

async function loadPersistedMongoDB(languageClient: MongoDBLanguageClient, codeLensProvider: MongoCodeLensProvider): Promise<void> {
    // NOTE: We want to make sure this function never throws or returns a rejected promise because it gets awaited multiple times
    await callWithTelemetryAndErrorHandling('cosmosDB.loadPersistedMongoDB', async (context: IActionContext) => {
        context.errorHandling.suppressDisplay = true;
        context.telemetry.properties.isActivationEvent = 'true';

        try {
            const persistedNodeId: string | undefined = ext.context.globalState.get(connectedMongoKey);
            if (persistedNodeId) {
                const persistedNode = await ext.tree.findTreeItem(persistedNodeId, context);
                if (persistedNode) {
                    await languageClient.client.onReady();
                    await vscode.commands.executeCommand('cosmosDB.connectMongoDB', persistedNode);
                }
            }
        } finally {
            // Get code lens provider out of initializing state if there's no connected DB
            if (!ext.connectedMongoDB) {
                codeLensProvider.setConnectedDatabase(undefined);
            }
        }
    });
}

function launchMongoShell(): void {
    const terminal: vscode.Terminal = vscode.window.createTerminal('Mongo Shell');
    terminal.sendText(`mongo`);
    terminal.show();
}

function setUpErrorReporting(): void {
    // Update errors immediately in case a scrapbook is already open
    void callWithTelemetryAndErrorHandling(
        "initialUpdateErrorsInActiveDocument",
        async (context: IActionContext) => {
            updateErrorsInScrapbook(context, vscode.window.activeTextEditor?.document);
        });

    // Update errors when document opened/changed
    registerEvent('vscode.workspace.onDidOpenTextDocument', vscode.workspace.onDidOpenTextDocument, updateErrorsInScrapbook);
    registerEvent(
        'vscode.workspace.onDidChangeTextDocument',
        vscode.workspace.onDidChangeTextDocument,
        async (context: IActionContext, event: vscode.TextDocumentChangeEvent) => {
            // Always suppress success telemetry - event happens on every keystroke
            context.telemetry.suppressIfSuccessful = true;

            updateErrorsInScrapbook(context, event.document);
        });
    registerEvent(
        'vscode.workspace.onDidCloseTextDocument',
        vscode.workspace.onDidCloseTextDocument,
        async (context: IActionContext, document: vscode.TextDocument) => {
            // Remove errors when closed
            if (document?.languageId === mongoLanguageId) {
                diagnosticsCollection.set(document.uri, []);
            } else {
                context.telemetry.suppressIfSuccessful = true;
            }
        });

    registerErrorHandler((context: IErrorHandlerContext) => {
        if (context.error instanceof MongoConnectError) {
            context.errorHandling.suppressReportIssue = true;
        }
    });
}

function updateErrorsInScrapbook(context: IActionContext, document: vscode.TextDocument | undefined): void {
    if (document?.languageId === mongoLanguageId) {
        const errors = getAllErrorsFromTextDocument(document);
        diagnosticsCollection.set(document.uri, errors);
    } else {
        context.telemetry.suppressIfSuccessful = true;
    }
}

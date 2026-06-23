/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { NestFactory } from '@nestjs/core';
import { CommandModule } from '@/cli/CommandModule.js';
import { NestLogger } from '@/NestLogger.js';
import { CommandService } from '@/cli/CommandService.js';

process.title = 'Misskey Cli';

Error.stackTraceLimit = Infinity;
EventEmitter.defaultMaxListeners = 128;

const app = await NestFactory.createApplicationContext(CommandModule, {
	logger: new NestLogger(),
});

const commandService = app.get(CommandService);

const command = process.argv[2] ?? 'help';

switch (command) {
	case 'help': {
		console.log('Available commands:');
		console.log('  help - Displays this help message');
		console.log('  reset-captcha - Resets the captcha');
		console.log('  show-deleted-remote-users - Shows remote users deleted logically');
		console.log('  delete-deleted-remote-users - Deletes remote users deleted logically');
		console.log('  show-users-by-host <host> - Shows users by host');
		console.log('  delete-users-by-host <host> - Deletes users by host');
		break;
	}
	case 'ping': {
		await commandService.ping();
		break;
	}
	case 'reset-captcha': {
		await commandService.resetCaptcha();
		console.log('Captcha has been reset.');
		break;
	}
	case 'show-deleted-remote-users': {
		await commandService.showDeletedRemoteUsers();
		break;
	}
	case 'delete-deleted-remote-users': {
		await commandService.deleteDeletedRemoteUsers();
		break;
	}
	case 'show-users-by-host': {
		const host = process.argv[3];
		if (!host) {
			console.error('Please provide a host.');
			process.exit(1);
		}
		await commandService.showUsersByHost(host);
		break;
	}
	case 'delete-users-by-host': {
		const host = process.argv[3];
		if (!host) {
			console.error('Please provide a host.');
			process.exit(1);
		}
		await commandService.deleteUsersByHost(host);
		break;
	}
	default: {
		console.error(`Unrecognized command: ${command}`);
		console.error('Use "help" to see available commands.');
		process.exit(1);
	}
}

process.exit(0);

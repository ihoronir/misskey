/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as readline from 'node:readline';
import { IsNull, Not } from 'typeorm';
import { Inject, Injectable } from '@nestjs/common';
import type { Config } from '@/config.js';
import { DI } from '@/di-symbols.js';
import type Logger from '@/logger.js';
import { bindThis } from '@/decorators.js';
import { MetaService } from '@/core/MetaService.js';
import { QueueService } from '@/core/QueueService.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import type { UsersRepository } from '@/models/_.js';

async function sleep(ms = 250): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

@Injectable()
export class CommandService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private metaService: MetaService,
		private queueService: QueueService,
		private httpRequestService: HttpRequestService,
	) {
	}

	@bindThis
	public async ping() {
		console.log('pong');
	}

	@bindThis
	public async resetCaptcha() {
		await this.metaService.update({
			enableHcaptcha: false,
			hcaptchaSiteKey: null,
			hcaptchaSecretKey: null,
			enableMcaptcha: false,
			mcaptchaSitekey: null,
			mcaptchaSecretKey: null,
			mcaptchaInstanceUrl: null,
			enableRecaptcha: false,
			recaptchaSiteKey: null,
			recaptchaSecretKey: null,
			enableTurnstile: false,
			turnstileSiteKey: null,
			turnstileSecretKey: null,
			enableTestcaptcha: false,
		});
	}

	@bindThis
	private async getDeletedRemoteUsers() {
		return await this.usersRepository.find({
			where: {
				isDeleted: true,
				host: Not(IsNull()),
			},
			select: {
				id: true,
				username: true,
				host: true,
			},
		});
	}

	@bindThis
	private async getHostUserCounts() {
		return await this.usersRepository
			.createQueryBuilder('user')
			.select('user.host', 'host')
			.addSelect('COUNT(*)', 'count')
			.groupBy('user.host')
			.orderBy('count', 'DESC')
			.getRawMany<{ host: string | null; count: string }>();
	}

	@bindThis
	private async getUsersByHost(host: string) {
		return await this.usersRepository.find({
			where: {
				host: host,
			},
			select: {
				id: true,
				username: true,
				host: true,
			},
		});
	}

	@bindThis
	private async enqueueDeleteUsers(users: { id: string; username: string; host: string | null }[]) {
		for (const user of users) {
			await this.queueService.createDeleteAccountJob(user, {
				soft: false,
			});
			console.log(`Queued deletion job for user ${user.id}: @${user.username}@${user.host}`);
			await sleep(100);
		}

		console.log('Queueing completed');
	}

	@bindThis
	public async showDeletedRemoteUsers() {
		const users = await this.getDeletedRemoteUsers();

		console.log(`Found ${users.length} deleted remote users:`);

		for (const user of users) {
			console.log(`- ${user.id}: @${user.username}@${user.host}`);
		}
	}

	@bindThis
	public async deleteDeletedRemoteUsers() {
		const users = await this.getDeletedRemoteUsers();

		console.log(`Found ${users.length} deleted remote users`);
		await this.enqueueDeleteUsers(users);
	}

	@bindThis
	public async showUsersByHost(host: string) {
		const users = await this.getUsersByHost(host);

		console.log(`Found ${users.length} users for host ${host}:`);

		for (const user of users) {
			console.log(`- ${user.id}: @${user.username}@${user.host}`);
		}
	}

	@bindThis
	public async deleteUsersByHost(host: string) {
		const users = await this.getUsersByHost(host);

		console.log(`Found ${users.length} users for host ${host}`);
		await this.enqueueDeleteUsers(users);
	}

	@bindThis
	private async confirm(message: string): Promise<boolean> {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		return new Promise(resolve => {
			rl.question(`${message} [y/N]: `, answer => {
				rl.close();
				resolve(answer.toLowerCase() === 'y');
			});
		});
	}

	@bindThis
	private async getHostResponseCategory(host: string): Promise<string> {
		const url = `https://${host}`;
		try {
			const res = await this.httpRequestService.send(url, {
				method: 'GET',
				timeout: 30000,
			}, {
				throwErrorWhenResponseNotOk: false,
			});
			return `HTTP ${res.status}`;
		} catch (err: unknown) {
			return this.categorizeNetworkError(err);
		}
	}

	@bindThis
	private categorizeNetworkError(err: unknown): string {
		const msg = err instanceof Error ? err.message : String(err);
		if (
			msg.includes('timeout')
		) {
			return 'Timeout';
		} else if (
			msg.includes('aborted') ||
			msg.includes('socket hang up') ||
			msg.includes('ECONNRESET') ||
			msg.includes('ECONNREFUSED') ||
			msg.includes('Client network socket disconnected')
		) {
			return 'Connection Reset';
		} else if (
			msg.includes('EHOSTUNREACH')
		) {
			return 'Unreachable';
		} else if (
			msg.includes('ENOTFOUND') ||
			msg.includes('EAI_AGAIN') ||
			msg.includes('ETIMEOUT') ||
			msg.includes('ESERVFAIL')
		) {
			return 'DNS Error';
		} else if (
			msg.includes('CERT') ||
			msg.includes('SSL') ||
			msg.includes('tls') ||
			msg.includes('depth zero') ||
			msg.includes('self-signed') ||
			msg.includes('unable to get local issuer certificate') ||
			msg.includes('unable to verify the first certificate') ||
			msg.includes('certificate has expired') ||
			msg.includes('Hostname/IP does not match')
		) {
			return 'SSL/TLS Error';
		} else if (msg.includes('maximum redirect reached')) {
			return 'Redirect Error';
		} else {
			return `Network Error (${msg})`;
		}
	}

	@bindThis
	private async getHostResponses(hosts: { host: string; count: string }[]): Promise<Map<string, string>> {
		const results = new Map<string, string>();
		const concurrency = Math.min(10, hosts.length);
		let index = 0;

		const workers = Array.from({ length: concurrency }, async () => {
			while (index < hosts.length) {
				const currentIndex = index++;
				const row = hosts[currentIndex];
				results.set(row.host, await this.getHostResponseCategory(row.host));
				if ((currentIndex + 1) % 100 === 0 || currentIndex + 1 === hosts.length) {
					console.log(`Progress: ${currentIndex + 1}/${hosts.length} hosts checked...`);
				}
			}
		});

		await Promise.all(workers);
		return results;
	}

	@bindThis
	public async summaryHosts() {
		const hosts = await this.getHostUserCounts();

		console.log('Host summary (users count):');
		for (const row of hosts) {
			console.log(`- ${row.host ?? '(Local)'}: ${row.count}`);
		}
	}

	@bindThis
	public async summaryHostsResponse() {
		const hosts = await this.getHostUserCounts();
		const remoteHosts = hosts.filter((row): row is { host: string; count: string } => row.host != null);

		console.log(`Checking responses for ${remoteHosts.length} hosts...`);

		const responses = await this.getHostResponses(remoteHosts);

		type HostResult = {
			host: string;
			users: number;
		};

		const groups: Record<string, HostResult[]> = {};

		const addToGroup = (groupName: string, host: string, users: number) => {
			const group = groups[groupName] ?? [];
			groups[groupName] = [...group, { host, users }];
		};

		for (const row of remoteHosts) {
			const category = responses.get(row.host);
			if (category != null) {
				addToGroup(category, row.host, parseInt(row.count, 10));
			}
		}

		console.log('\n--- Host Response Summary ---');

		const groupTotals = Object.entries(groups).map(([name, list]) => {
			const totalUsers = list.reduce((sum, item) => sum + item.users, 0);
			return { name, list, totalUsers };
		});

		groupTotals.sort((a, b) => b.totalUsers - a.totalUsers);

		for (const { name, list, totalUsers } of groupTotals) {
			list.sort((a, b) => b.users - a.users);

			console.log(`\n\n\n\nservers returned ${name}: (${list.length} servers, ${totalUsers} total users)`);
			for (const item of list) {
				console.log(`- ${item.host} (${item.users} users)`);
			}
		}
	}

	@bindThis
	public async deleteUsersByHostResponseCategory(category: string) {
		const hosts = await this.getHostUserCounts();
		const remoteHosts = hosts.filter((row): row is { host: string; count: string } => row.host != null);

		console.log(`Checking responses to classify hosts for category: ${category}...`);

		const responses = await this.getHostResponses(remoteHosts);

		const targetHosts: string[] = [];
		let totalUsers = 0;

		for (const row of remoteHosts) {
			if (responses.get(row.host) === category) {
				targetHosts.push(row.host);
				totalUsers += parseInt(row.count, 10);
			}
		}

		if (targetHosts.length === 0) {
			console.log('No hosts found in this category.');
			return;
		}

		console.log(`Found ${targetHosts.length} hosts (${totalUsers} users) in category: ${category}`);
		console.log('Hosts:', targetHosts.join(', '));

		if (await this.confirm('Are you sure you want to delete all users from these hosts?')) {
			for (const host of targetHosts) {
				const users = await this.getUsersByHost(host);
				console.log(`Deleting ${users.length} users from ${host}`);
				await this.enqueueDeleteUsers(users);
			}
		} else {
			console.log('Deletion cancelled.');
		}
	}
}

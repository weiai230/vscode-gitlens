'use strict';
import * as paths from 'path';
import { Command, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs } from '../../commands';
import { CommitFileNode } from './commitFileNode';
import { ViewFilesLayout } from '../../configuration';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { FileNode, FolderNode } from './folderNode';
import {
	CommitFormatter,
	GitBranch,
	GitLogCommit,
	GitRemote,
	GitRevisionReference,
	IssueOrPullRequest,
	PullRequest,
} from '../../git/git';
import { StashesView } from '../stashesView';
import { Arrays, Strings } from '../../system';
import { ViewsWithFiles } from '../viewBase';
import { ContextValues, ViewNode, ViewRefNode } from './viewNode';

export class CommitNode extends ViewRefNode<ViewsWithFiles, GitRevisionReference> {
	constructor(
		view: ViewsWithFiles,
		parent: ViewNode,
		public readonly commit: GitLogCommit,
		public readonly branch?: GitBranch,
		private readonly getBranchAndTagTips?: (sha: string) => string | undefined,
		private readonly _options: { expand?: boolean } = {},
	) {
		super(commit.toGitUri(), view, parent);
	}

	toClipboard(): string {
		return this.commit.sha;
	}

	get ref(): GitRevisionReference {
		return this.commit;
	}

	private get tooltip() {
		return CommitFormatter.fromTemplate(
			this.commit.isUncommitted
				? `\${author} ${GlyphChars.Dash} \${id}\n\${ago} (\${date})`
				: `\${author}\${ (email)}\${" via "pullRequest} ${
						GlyphChars.Dash
				  } \${id}\${ (tips)}\n\${ago} (\${date})\${\n\nmessage}${this.commit.getFormattedDiffStatus({
						expand: true,
						prefix: '\n\n',
						separator: '\n',
				  })}\${\n\n${GlyphChars.Dash.repeat(2)}\nfootnotes}`,
			this.commit,
			{
				autolinkedIssues: this._details?.autolinkedIssues,
				dateFormat: Container.config.defaultDateFormat,
				getBranchAndTagTips: this.getBranchAndTagTips,
				messageAutolinks: true,
				messageIndent: 4,
				pullRequestOrRemote: this._details?.pr,
				remotes: this._details?.remotes,
			},
		);
	}

	getChildren(): ViewNode[] {
		const commit = this.commit;

		let children: FileNode[] = commit.files.map(
			s => new CommitFileNode(this.view, this, s, commit.toFileCommit(s)!),
		);

		if (this.view.config.files.layout !== ViewFilesLayout.List) {
			const hierarchy = Arrays.makeHierarchical(
				children,
				n => n.uri.relativePath.split('/'),
				(...parts: string[]) => Strings.normalizePath(paths.join(...parts)),
				this.view.config.files.compact,
			);

			const root = new FolderNode(this.view, this, this.repoPath, '', hierarchy);
			children = root.getChildren() as FileNode[];
		} else {
			children.sort((a, b) =>
				a.label!.localeCompare(b.label!, undefined, { numeric: true, sensitivity: 'base' }),
			);
		}
		return children;
	}

	getTreeItem(): TreeItem {
		const label = CommitFormatter.fromTemplate(this.view.config.commitFormat, this.commit, {
			dateFormat: Container.config.defaultDateFormat,
			getBranchAndTagTips: this.getBranchAndTagTips,
			messageTruncateAtNewLine: true,
		});

		const item = new TreeItem(
			label,
			this._options.expand ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed,
		);

		item.contextValue = `${ContextValues.Commit}${this.branch?.current ? '+current' : ''}${
			this._details == null
				? '+details'
				: `${this._details?.autolinkedIssues != null ? '+autolinks' : ''}${
						this._details?.pr != null ? '+pr' : ''
				  }`
		}`;

		item.description = CommitFormatter.fromTemplate(this.view.config.commitDescriptionFormat, this.commit, {
			messageTruncateAtNewLine: true,
			dateFormat: Container.config.defaultDateFormat,
		});
		item.iconPath =
			!(this.view instanceof StashesView) && this.view.config.avatars
				? this.commit.getAvatarUri(Container.config.defaultGravatarsStyle)
				: new ThemeIcon('git-commit');
		item.tooltip = this.tooltip;

		return item;
	}

	getCommand(): Command | undefined {
		const commandArgs: DiffWithPreviousCommandArgs = {
			commit: this.commit,
			uri: this.uri,
			line: 0,
			showOptions: {
				preserveFocus: true,
				preview: true,
			},
		};
		return {
			title: 'Open Changes with Previous Revision',
			command: Commands.DiffWithPrevious,
			arguments: [undefined, commandArgs],
		};
	}

	private _details:
		| {
				autolinkedIssues: Map<string, IssueOrPullRequest | Promises.CancellationError | undefined> | undefined;
				pr: PullRequest | undefined;
				remotes: GitRemote[];
		  }
		| undefined = undefined;

	async loadDetails() {
		if (this._details != null) return;

		const remotes = await Container.git.getRemotes(this.commit.repoPath);
		const remote = await Container.git.getRemoteWithApiProvider(remotes);
		if (remote?.provider == null) return;

		const [autolinkedIssues, pr] = await Promise.all([
			Container.autolinks.getIssueOrPullRequestLinks(this.commit.message, remote),
			Container.git.getPullRequestForCommit(this.commit.ref, remote.provider),
		]);

		this._details = {
			autolinkedIssues: autolinkedIssues,
			pr: pr,
			remotes: remotes,
		};

		// TODO@eamodio
		// Add autolinks action to open a quickpick to pick the autolink
		// Add pr action to open the pr

		void this.triggerChange();
	}
}

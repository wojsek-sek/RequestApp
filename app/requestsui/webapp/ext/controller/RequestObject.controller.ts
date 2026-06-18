import BaseControllerExtension from 'sap/fe/core/controllerextensions/BaseControllerExtension';
import type ObjectPageController from 'sap/fe/templates/ObjectPage/ObjectPageController.controller';
import JSONModel from 'sap/ui/model/json/JSONModel';
import DateFormat from 'sap/ui/core/format/DateFormat';
import type View from 'sap/ui/core/mvc/View';
import type ResourceModel from 'sap/ui/model/resource/ResourceModel';
import type ResourceBundle from 'sap/base/i18n/ResourceBundle';
import type ODataV4Context from 'sap/ui/model/odata/v4/Context';

/**
 * Shape of the Request fields we read to build the approval timeline.
 */
interface RequestData {
	createdAt?: string;
	createdBy?: string;
	modifiedAt?: string;
	modifiedBy?: string;
	status_code?: string;
	costCenter?: string;
	aiComplianceScore?: number | null;
	aiAuditNotes?: string | null;
	aiCheckedAt?: string | null;
	approver?: string | null;
	approvalDate?: string | null;
	justification?: string | null;
	rejectReason?: string | null;
	cancelReason?: string | null;
	submittedAt?: string | null;
	withdrawnAt?: string | null;
}

interface TimelineEvent {
	title: string;
	statusText: string;
	text?: string;
	dateTime?: string;
	userName?: string;
	icon: string;
	/**
	 * sap.ui.core.ValueState string that colors the timeline node/icon natively (no CSS).
	 * Mirrors the backend criticality rules:
	 *   None=neutral/gray · Information=blue · Success=green · Warning=orange · Error=red
	 */
	status: string;
	statusAI?: string; // optional extra field for the AI score label (green/orange/red)
}

/**
 * Map an AI compliance score to a ValueState using the SAME thresholds as the backend
 * AIScoreDataPoint criticality (annotations.cds): >=80 → green, <50 → red, else orange.
 */
function aiScoreState(score: number): string {
	if (score >= 80) {
		return 'Success';
	}

	return score < 50 ? 'Error' : 'Warning';
}

/**
 * i18n key for the AI status label — uses the SAME thresholds as aiScoreState so the
 * colored text and the colored icon always agree:
 *   >=80 → positive (green) · <50 → non-compliant (red) · 50-79 → review needed (orange)
 */
function aiScoreTextKey(score: number): string {
	if (score >= 80) {
		return 'timelineAiPositive';
	}

	return score < 50 ? 'timelineAiNegative' : 'timelineAiReview';
}

/**
 * Format an OData V4 timestamp/date string for display in the timeline.
 * Module-level (no `this`) so it works regardless of how FE binds `this` in the override hooks.
 */
function formatDateTime(value?: string | null): string | undefined {
	if (!value) {
		return undefined;
	}
	const date = new Date(value);

	return isNaN(date.getTime()) ? value : DateFormat.getDateTimeInstance({ style: 'medium' }).format(date);
}

/** Translate the flat Request fields into ordered, localized timeline events. */
function buildTimeline(data: RequestData, bundle: ResourceBundle): TimelineEvent[] {
	const events: TimelineEvent[] = [];
	const status = data.status_code;
	const t = (key: string, args?: (string | number)[]): string => bundle.getText(key, args) ?? key;
	// 1) Created — always present.
	events.push({
		title: t('timelineCreated'),
		statusText: t('timelineNew'),
		text: data.costCenter ? t('timelineCostCenter', [data.costCenter]) : undefined,
		dateTime: formatDateTime(data.createdAt),
		userName: data.createdBy ?? undefined,
		icon: 'sap-icon://create',
		status: 'None' // gray / neutral
	});

	// 2) AI Compliance Check — only once the AI has scored the request.
	if (data.aiComplianceScore != null) {
		events.push({
			title: t('timelineAiCheck'),
			statusText: t('timelineAiScore', [data.aiComplianceScore, t(aiScoreTextKey(data.aiComplianceScore))]),
			text: data.aiAuditNotes ?? undefined,
			dateTime: formatDateTime(data.aiCheckedAt),
			userName: t('timelineAiUser'),
			icon: 'sap-icon://ai',
			status: 'Information',
			statusAI: aiScoreState(data.aiComplianceScore)
		});
	}

	// 3) Submitted — shown whenever the request was ever submitted (submittedAt set).
	//    Using submittedAt instead of modifiedAt: modifiedAt is overwritten on every subsequent
	//    operation (approve/reject/withdraw) so it would show the wrong date.
	if (data.submittedAt) {
		events.push({
			title: t('timelineSubmitted'),
			statusText: t('timelineSubmitted'),
			text: t('timelineSubmittedText'),
			dateTime: formatDateTime(data.submittedAt),
			userName: data.modifiedBy ?? undefined,
			icon: 'sap-icon://outbox',
			status: 'Information'
		});
	}

	// 3b) Withdrawn — request was pulled back to New for revision.
	if (data.withdrawnAt) {
		events.push({
			title: t('timelineWithdrawn'),
			statusText: t('timelineWithdrawn'),
			text: t('timelineWithdrawnText'),
			dateTime: formatDateTime(data.withdrawnAt),
			icon: 'sap-icon://undo',
			status: 'None'
		});
	}

	// 4) Final decision — Approved / Rejected / Cancelled.
	if (status === 'A') {
		events.push({
			title: t('timelineApproved'),
			statusText: t('timelineApproved'),
			text: data.justification ?? undefined,
			dateTime: formatDateTime(data.approvalDate),
			userName: data.approver ?? undefined,
			icon: 'sap-icon://accept',
			status: 'Success' // green
		});
	} else if (status === 'R') {
		events.push({
			title: t('timelineRejected'),
			statusText: t('timelineRejected'),
			text: data.rejectReason ?? undefined,
			dateTime: formatDateTime(data.approvalDate),
			userName: data.approver ?? undefined,
			icon: 'sap-icon://decline',
			status: 'Error' // red
		});
	} else if (status === 'C') {
		events.push({
			title: t('timelineCancelled'),
			statusText: t('timelineCancelled'),
			text: data.cancelReason ?? undefined,
			icon: 'sap-icon://sys-cancel',
			status: 'Warning' // orange (mirrors status criticality 2)
		});
	}

	return events;
}

/** Read the bound Request and (re)build the "timeline" JSON model on the given view. */
async function refreshTimeline(view: View, oContext: object | null): Promise<void> {
	// Empty/zero-state until data arrives.
	if (!oContext) {
		view.setModel(new JSONModel({ events: [] }), 'timeline');
		return;
	}

	// The Object Page only $selects fields it renders, so many timeline fields are not in the
	// context yet. requestObject() cannot fetch unselected properties — requestProperty() issues
	// a late property request for exactly these paths and returns their values in order.
	const fields: (keyof RequestData)[] = [
		'createdAt', 'createdBy', 'modifiedAt', 'modifiedBy', 'status_code', 'costCenter',
		'aiComplianceScore', 'aiAuditNotes', 'aiCheckedAt',
		'approver', 'approvalDate', 'justification',
		'rejectReason', 'cancelReason', 'submittedAt', 'withdrawnAt'
	];

	const ctx = oContext as ODataV4Context;
	const [bundle, values] = await Promise.all([
		(view.getModel('i18n') as ResourceModel).getResourceBundle(),
		ctx.requestProperty(fields as string[]) as Promise<unknown[]>
	]);

	const data: RequestData = {};
	fields.forEach((field, i) => {
		(data as Record<string, unknown>)[field] = values[i];
	});

	view.setModel(new JSONModel({ events: buildTimeline(data, bundle) }), 'timeline');
}

/**
 * Controller extension for the Requests Object Page.
 * Builds the client-side "Approval Timeline" JSON model once the Request is bound.
 *
 * @namespace capmap.requestsui.ext.controller
 */
export default class RequestObject extends BaseControllerExtension<ObjectPageController> {
	static overrides = BaseControllerExtension.createExtensionOverrides<RequestObject>({
		routing: {
			/**
			 * Fires after the Object Page is bound to a Request. `this` here is FE's routing
			 * extension, so we reach the view via `this.base` (the host controller) and delegate
			 * to module-level helpers instead of instance methods.
			 */
			onAfterBinding(this: RequestObject, oContext: object | null): void {
				const view = this.base.getView();
				if (view) {
					void refreshTimeline(view, oContext);
				}
			}
		}
	});
}

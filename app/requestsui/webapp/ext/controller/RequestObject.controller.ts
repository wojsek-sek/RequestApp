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
	approver?: string | null;
	approvalDate?: string | null;
	justification?: string | null;
	rejectReason?: string | null;
	cancelReason?: string | null;
}

interface TimelineEvent {
	title: string;
	statusText: string;
	text?: string;
	dateTime?: string;
	userName?: string;
	icon: string;
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
		icon: 'sap-icon://create'
	});

	// 2) AI Compliance Check — only once the AI has scored the request.
	if (data.aiComplianceScore != null) {
		events.push({
			title: t('timelineAiCheck', [data.aiComplianceScore]),
			statusText: data.aiComplianceScore >= 70 ? t('timelineAiPositive') : t('timelineAiReview'),
			text: data.aiAuditNotes ?? undefined,
			userName: t('timelineAiUser'),
			icon: 'sap-icon://artificial-intelligence'
		});
	}

	// 3) Submitted — present once the request left the New state.
	if (status && status !== 'N') {
		events.push({
			title: t('timelineSubmitted'),
			statusText: t('timelineSubmitted'),
			text: t('timelineSubmittedText'),
			dateTime: formatDateTime(data.modifiedAt),
			userName: data.modifiedBy ?? undefined,
			icon: 'sap-icon://outbox'
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
			icon: 'sap-icon://accept'
		});
	} else if (status === 'R') {
		events.push({
			title: t('timelineRejected'),
			statusText: t('timelineRejected'),
			text: data.rejectReason ?? undefined,
			dateTime: formatDateTime(data.approvalDate),
			userName: data.approver ?? undefined,
			icon: 'sap-icon://decline'
		});
	} else if (status === 'C') {
		events.push({
			title: t('timelineCancelled'),
			statusText: t('timelineCancelled'),
			text: data.cancelReason ?? undefined,
			icon: 'sap-icon://sys-cancel'
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
		'aiComplianceScore', 'aiAuditNotes', 'approver', 'approvalDate', 'justification',
		'rejectReason', 'cancelReason'
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

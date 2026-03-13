import "../agent/tools/index.js"; // register tools
import { createPlan } from "../agent/plan.js";
import { executePlan } from "../agent/execute.js";
import { bindConnector } from "../sessionStore.js";
import { registerConnector, resolveConnectorResult, getConnectedConnectorIds } from "../connectorHub.js";
import { getPlan, savePlan } from "../planStore.js";

async function run() {
  const sessionId = "test-session-calendar";
  const connectorId = "rae-mac";

  const fakeSocket: any = {
    send: (data: string) => {
      try {
        const msg = JSON.parse(data);
        if (msg?.type === "connector.invoke") {
          // Simulate async connector behavior for manage_calendar
          setTimeout(() => {
            const action = msg.data.args?.action || 'create';
            if (action === 'save') {
              resolveConnectorResult({ requestId: msg.data.requestId, ok: true, result: { success: true, action: 'save', event: { title: msg.data.args?.title || 'Investor Demo', date: msg.data.args?.date || '2026-03-13', time: msg.data.args?.time || '15:00' }, status: 'created', created: true } });
            } else {
              resolveConnectorResult({ requestId: msg.data.requestId, ok: true, result: { success: true, action, event: { title: msg.data.args?.title || 'Investor Demo', date: msg.data.args?.date || '2026-03-13', time: msg.data.args?.time || '15:00' }, status: 'form_ready', suggestedActions: [{ label: 'Save this calendar event', tool: 'browser.manage_calendar', args: { action: 'save' } }] } });
            }
          }, 50);
        }
      } catch (e) {
        console.error("fakeSocket parse error", e);
      }
    },
  };

  registerConnector(connectorId, fakeSocket);
  console.log("registered connectors:", getConnectedConnectorIds());

  bindConnector(sessionId, connectorId);
  console.log(`bound session ${sessionId} -> ${connectorId}`);

  const prompt = "Schedule a meeting tomorrow at 3pm called 'Investor Demo'";
  const plan = await createPlan({ sessionId, prompt });
  console.log("plan:", JSON.stringify(plan, null, 2));

  // Append a follow-up Save step so the executor will click Save after the form is filled
  try {
    const stored = getPlan(plan.planId);
    stored.steps.push({ id: 's2', tool: 'browser.manage_calendar', description: '保存日历事件', args: { action: 'save' }, saveAs: 'calendar_saved' });
    savePlan(plan.planId, stored);
    console.log('Appended save step to plan');
  } catch (e) {
    console.warn('Could not append save step to plan', e);
  }

  const run = await executePlan({ sessionId, planId: plan.planId, approved: true, emit: (_e, _d) => {}, outboxDir: "./src/outbox" });
  console.log("run result:", JSON.stringify(run, null, 2));
}

run().catch((e) => { console.error(e); process.exit(1); });

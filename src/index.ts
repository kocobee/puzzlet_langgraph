
import 'dotenv/config';
import { StateGraph, Annotation, interrupt, Command, MemorySaver } from "@langchain/langgraph";
import { Puzzlet } from "@puzzlet/sdk";
import { ModelPluginRegistry, createTemplateRunner } from "@puzzlet/agentmark";
import type { AgentMarkOutputV2 } from '@puzzlet/agentmark';
import PuzzletTypes from "./puzzlet.types";
import OpenAI from "@puzzlet/openai";

const puzzletClient = new Puzzlet<PuzzletTypes>({
  apiKey: process.env.PUZZLET_API_KEY!,
  appId: process.env.PUZZLET_APP_ID!,
  baseUrl: process.env.PUZZLET_BASE_URL!,
}, createTemplateRunner);
const tracer = puzzletClient.initTracing();
tracer.start();

ModelPluginRegistry.register(new OpenAI(), ["gpt-4o"]);

const EMAIL_ACTIONS = {
  SEND_EMAIL: "sendEmail",
  REJECT_EMAIL: "rejectEmail",
}

// A customer support agent that uses a prompt to generate an email
async function customerSupport() {
  // Simulating some customer support props
  const customerSupportProps = {
    emailContent: "Hey, I've been trying to log into my account but keep getting an error message. Can you help?",
  }
  const prompt = await puzzletClient.fetchPrompt('customer_support.prompt.mdx');
  const telemetry = {
    isEnabled: true,
    functionId: 'createEmail',
    metadata: { userId: 'example-user-id' }
  };
  const resp = await prompt.run(customerSupportProps, { telemetry });
  return { customerSupport: resp };
}

function humanApproval(state: typeof StateAnnotation.State): Command {
  let emailAction = EMAIL_ACTIONS.REJECT_EMAIL;
  if (state.customerSupport.tools?.[0].name === "send_email") {
    emailAction = interrupt({
      question: "Does this email look good?",
      // Surface the email that should be
      // reviewed and approved by the human.
      body: state.customerSupport.tools?.[0].input.body,
      title: state.customerSupport.tools?.[0].input.title,
    });
  }

  if (emailAction === EMAIL_ACTIONS.SEND_EMAIL) {
    return new Command({ goto: EMAIL_ACTIONS.SEND_EMAIL });
  } else {
    return new Command({ goto: EMAIL_ACTIONS.REJECT_EMAIL });
  }
}
function executeSendEmail(state: typeof StateAnnotation.State) {
  console.log("SENDING EMAIL TITLE", state.customerSupport.tools?.[0].input.title);
  console.log("SENDING EMAIL BODY", state.customerSupport.tools?.[0].input.body);
  return state;
}

function rejectSendEmail(state: typeof StateAnnotation.State) {
  console.log("REJECTING EMAIL");
  return state;
}

export const StateAnnotation = Annotation.Root({
  customerSupport: Annotation<AgentMarkOutputV2>({
    reducer: (state: AgentMarkOutputV2, update: AgentMarkOutputV2) => update,
  }),
});

const builder = new StateGraph(StateAnnotation)
  .addNode("support", customerSupport)
  .addNode("verify", humanApproval)
  .addNode("sendEmail", executeSendEmail, { ends: [EMAIL_ACTIONS.SEND_EMAIL] })
  .addNode("rejectEmail", rejectSendEmail, { ends: [EMAIL_ACTIONS.REJECT_EMAIL] })
  .addEdge("__start__", "support")
  .addEdge("support", "verify")

async function main() {
  const graph = builder.compile({
    checkpointer: new MemorySaver(),
  });
  const config = { configurable: { thread_id: "1" } };

  for await (const event of await graph.stream({}, config)) {
    console.log(event);
  }
  console.log("--- GRAPH INTERRUPTED ---");
  console.log("--- SIMULATING HUMAN APPROVAL ---");

  // Change to EMAIL_ACTIONS.REJECT_EMAIL to see the email rejected
  for await (const event of await graph.stream(
    new Command({ resume: EMAIL_ACTIONS.SEND_EMAIL }),
    config,
  )) {
    console.log("\n====\n");
  }
}

main().catch(console.error);
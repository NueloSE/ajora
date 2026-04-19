// ---------------------------------------------------------------------------
// Tool Executor — runs what Claude decided to do
// ---------------------------------------------------------------------------
// Takes the tool_use blocks from Claude's response and either:
//   - submits a Stellar transaction, or
//   - logs a notification (notification delivery is pluggable — Slack, email,
//     push — but for the hackathon demo we log to console and a JSON file)

import fs from "fs";
import path from "path";
import { closeCycle, flagDefault } from "./stellar.js";
import { sendTelegram, truncateAddress } from "./telegram.js";

const LOG_FILE = path.join(process.cwd(), "agent_log.jsonl");

function log(entry: Record<string, unknown>) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

// ---------------------------------------------------------------------------

export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
): Promise<string> {
  log({ tool: toolName, input });

  switch (toolName) {

    case "send_reminder": {
      const { group_name, member, hours_left, amount } = input as {
        group_name: string; member: string; hours_left: number; amount: string;
      };
      const tgMessage =
        `⏰ *Contribution Reminder*\n\n` +
        `*Group:* ${group_name}\n` +
        `*Member:* \`${truncateAddress(member)}\`\n` +
        `*Amount due:* ${amount}\n` +
        `*Time left:* ~${hours_left} hours\n\n` +
        `Please contribute before the cycle deadline to avoid being flagged as a default. 🙏`;
      await sendTelegram(tgMessage);
      log({ action: "reminder_sent", group_name, member, hours_left, amount });
      return `Reminder sent via Telegram for ${member}: ${hours_left}h left to contribute ${amount}`;
    }

    case "flag_default": {
      const { group_id, contract_type, member, reason } = input as {
        group_id: number; contract_type: "rotating" | "target";
        member: string; reason: string;
      };
      try {
        const txHash = await flagDefault(contract_type, group_id, member);
        await sendTelegram(
          `🚨 *Member Defaulted*\n\n` +
          `*Group ID:* ${group_id}\n` +
          `*Member:* \`${truncateAddress(member)}\`\n` +
          `*Reason:* ${reason}\n` +
          `*On-chain tx:* \`${txHash}\`\n\n` +
          `This member has been flagged on-chain and is blocked from future groups.`,
        );
        log({ action: "default_flagged", group_id, member, txHash });
        return `Default flagged on-chain. Tx: ${txHash}`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log({ action: "flag_default_failed", group_id, member, error: msg });
        return `flag_default failed: ${msg}`;
      }
    }

    case "close_cycle": {
      const { group_id, group_name, reason } = input as {
        group_id: number; group_name: string; reason: string;
      };
      try {
        const txHash = await closeCycle(group_id);
        await sendTelegram(
          `✅ *Cycle Closed — Payout Sent*\n\n` +
          `*Group:* ${group_name}\n` +
          `*Reason:* ${reason}\n` +
          `*On-chain tx:* \`${txHash}\`\n\n` +
          `The payout has been automatically sent to the next recipient. 🎉`,
        );
        log({ action: "cycle_closed", group_id, group_name, txHash, reason });
        return `Cycle closed. Payout sent. Tx: ${txHash}`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log({ action: "close_cycle_failed", group_id, error: msg });
        return `close_cycle failed: ${msg}`;
      }
    }

    case "alert_payout": {
      const { group_name, recipient, amount, tx_hash } = input as {
        group_name: string; recipient: string; amount: string; tx_hash?: string;
      };
      await sendTelegram(
        `💰 *Payout Received!*\n\n` +
        `*Group:* ${group_name}\n` +
        `*Recipient:* \`${truncateAddress(recipient)}\`\n` +
        `*Amount:* ${amount}\n` +
        (tx_hash ? `*Transaction:* \`${tx_hash}\`\n` : "") +
        `\nThe funds have been sent to your Stellar wallet. Open Ajora to view your balance. 🚀`,
      );
      log({ action: "payout_alert", group_name, recipient, amount, tx_hash });
      return `Payout alert sent to ${recipient}`;
    }

    case "alert_forming_group": {
      const { group_name, members_needed, amount, total_cycles } = input as {
        group_name: string; members_needed: number; amount: string; total_cycles?: number;
      };
      await sendTelegram(
        `📢 *New Savings Group Forming*\n\n` +
        `*Group:* ${group_name}\n` +
        `*Spots remaining:* ${members_needed}\n` +
        `*Contribution:* ${amount} per cycle\n` +
        (total_cycles ? `*Total cycles:* ${total_cycles}\n` : "") +
        `\nJoin now on Ajora before the group fills up! 👥`,
      );
      log({ action: "forming_alert", group_name, members_needed, amount });
      return `Forming alert broadcast for ${group_name}`;
    }

    case "no_action": {
      const { group_id, reason } = input as { group_id: number; reason: string };
      log({ action: "no_action", group_id, reason });
      return `No action needed: ${reason}`;
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}

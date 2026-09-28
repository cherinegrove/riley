const { createClient } = require("@supabase/supabase-js");
const { differenceInDays } = require("date-fns");

const supabaseUrl = process.env.DONEZY_SUPABASE_URL;
const supabaseKey = process.env.DONEZY_SUPABASE_SERVICE_ROLE_KEY || process.env.DONEZY_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.log("Missing Supabase credentials. Set DONEZY_SUPABASE_URL and DONEZY_SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function getRuannStatus() {
  try {
    const { data, error } = await supabase
      .from("tasks_with_assignees")
      .select("*")
      .eq("assignee_name", "Ruann Kruger")
      .neq("status", "completed")
      .neq("status", "done")
      .neq("status", "backlog");

    if (error) throw error;

    const now = new Date();
    const activeStatuses = ["todo", "in_progress", "awaiting_feedback_internal", "awaiting_feedback_external", "blocked"];

    const tasks = (data || []).map((row) => ({
      title: row.title,
      status: row.status,
      due_date: row.due_date,
      updated_at: row.updated_at,
      project: row.project_name,
      days_overdue: row.due_date ? differenceInDays(now, new Date(row.due_date)) : 0,
    }));

    const atRiskTasks = tasks.filter((task) => {
      if (!activeStatuses.includes(task.status)) return false;
      
      if (task.days_overdue > 0) return true;
      
      const daysSinceUpdate = Math.floor((now.getTime() - new Date(task.updated_at).getTime()) / (1000 * 60 * 60 * 24));
      if (daysSinceUpdate >= 7) return true;
      
      const hoursSinceUpdate = Math.floor((now.getTime() - new Date(task.updated_at).getTime()) / (1000 * 60 * 60));
      if ((task.status === "awaiting_feedback_internal" || task.status === "awaiting_feedback_external") && hoursSinceUpdate >= 24) return true;
      
      return false;
    });

    const overdue = atRiskTasks.filter((t) => t.days_overdue > 0);
    const awaitingFeedback = atRiskTasks.filter((t) => t.status.includes("awaiting_feedback"));
    const stale = atRiskTasks.filter((t) => {
      const daysSinceUpdate = Math.floor((now.getTime() - new Date(t.updated_at).getTime()) / (1000 * 60 * 60 * 24));
      return daysSinceUpdate >= 7 && t.days_overdue <= 0;
    });

    console.log("\n📊 RUANN KRUGER - AT-RISK TASKS SUMMARY");
    console.log("=====================================\n");
    console.log(`🚨 OVERDUE: ${overdue.length} tasks`);
    overdue.slice(0, 5).forEach((t) => {
      console.log(`   • ${t.title} (${t.days_overdue} days) - ${t.project}`);
    });
    if (overdue.length > 5) console.log(`   ... and ${overdue.length - 5} more`);

    console.log(`\n⏰ AWAITING FEEDBACK: ${awaitingFeedback.length} tasks`);
    awaitingFeedback.slice(0, 5).forEach((t) => {
      console.log(`   • ${t.title} - ${t.project}`);
    });
    if (awaitingFeedback.length > 5) console.log(`   ... and ${awaitingFeedback.length - 5} more`);

    console.log(`\n⏳ STALE (7+ days): ${stale.length} tasks`);
    stale.slice(0, 5).forEach((t) => {
      console.log(`   • ${t.title} - ${t.project}`);
    });
    if (stale.length > 5) console.log(`   ... and ${stale.length - 5} more`);

    console.log(`\n📈 Total At-Risk: ${atRiskTasks.length} tasks (out of ${tasks.length} active tasks)`);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

getRuannStatus();

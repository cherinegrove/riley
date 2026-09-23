import { createDonezyIntegration } from './src/integrations/donezy';

const url = 'https://puwxkygdlclcbyxrtppd.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1d3hreWdkbGNsY2J5eHJ0cHBkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDYxMDU2OTUsImV4cCI6MjA2MTY4MTY5NX0._p3ZxKJSSzOkZO6xml4kvg9vOA64Qlxhg5HNhuEAF-0';

const donezy = createDonezyIntegration(url, key);

async function test() {
  try {
    console.log('Testing Donezy connection...\n');

    const tasks = await donezy.getAllTasks();
    console.log(`✅ Total tasks: ${tasks.length}\n`);

    if (tasks.length > 0) {
      // Get unique assignees
      const assignees = new Set(tasks.map(t => t.assigned_to));
      console.log(`👥 Assignees: ${Array.from(assignees).join(', ')}\n`);

      // Show Ruann Kruger's tasks
      const ruannTasks = tasks.filter(t => t.assigned_to.includes('Ruann'));
      console.log(`🎯 Ruann Kruger's tasks: ${ruannTasks.length}`);

      if (ruannTasks.length > 0) {
        ruannTasks.forEach((task, i) => {
          console.log(`\n${i + 1}. "${task.title}"`);
          console.log(`   Status: ${task.status}`);
          console.log(`   Due: ${task.due_date}`);
          console.log(`   Project: ${task.project_name}`);
          console.log(`   Overdue: ${task.days_overdue || 'No'}`);
        });
      }

      // Check at-risk tasks
      const atRisk = await donezy.getAllRiskTasksGroupedByAssignee();
      console.log(`\n🚨 At-risk tasks found: ${JSON.stringify(atRisk, null, 2)}`);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

test();

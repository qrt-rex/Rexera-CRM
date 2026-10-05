import type { AutomationKey, EmailAutomation } from './types'

/** Built-in email automations and their default wording (HR can edit the wording in Email Center). */
export const AUTOMATIONS: { key: AutomationKey; name: string; when: string; schedule: 'event' | 'daily' | 'monthly'; on: boolean; subject: string; body: string }[] = [
  { key: 'welcome', name: 'Welcome new account', when: 'When HR or IT creates an account', schedule: 'event', on: true,
    subject: 'Welcome to Rexera CRM, {first_name}!',
    body: 'Hi {first_name},\n\nYour Rexera CRM account is ready.\n\nSign in at: {login_url}\nYour login email: {email}\nYour role: {role}\n\nAsk HR for your temporary password on your first day, then change it in Settings → Security.\n\nWelcome aboard!\n— HR Team, {company}' },
  { key: 'leave-decision', name: 'Leave approved / rejected', when: 'When a leave request is decided', schedule: 'event', on: true,
    subject: 'Your leave request was {status}',
    body: 'Hi {first_name},\n\nYour {leave_type} request for {leave_dates} ({leave_days} day(s)) was {status} by {decided_by}.{remark}\n\nSee Leave in Rexera CRM: {login_url}\n— HR Team' },
  { key: 'payslip-ready', name: 'Payslip ready', when: 'When a payroll month is finalised', schedule: 'event', on: true,
    subject: 'Your payslip for {month} is ready',
    body: 'Hi {first_name},\n\nYour payslip for {month} is ready. Open Payslips in Rexera CRM to view or print it: {login_url}\n\n— HR Team, {company}' },
  { key: 'start-day-reminder', name: '“Start your day” reminder', when: 'Mon–Sat after 10:30 am, to anyone who has not started their day and is not on leave', schedule: 'daily', on: true,
    subject: 'Reminder: start your day in Rexera CRM',
    body: "Hi {first_name},\n\nWe haven't seen your login today ({date}). Please open Rexera CRM and press “Start my day”: {login_url}\n\nIf you're on leave, please apply for it in Leave.\n— HR Team" },
  { key: 'monthly-attendance', name: 'Monthly attendance summary', when: 'On the 1st, for the month just ended', schedule: 'monthly', on: true,
    subject: 'Your attendance for {month}',
    body: 'Hi {first_name},\n\nHere is your attendance for {month}:\n• Days logged in: {present}\n• Approved leave days: {leave}\n\nSpotted a mistake? Reply to HR within 3 days.\n— HR Team' },
  { key: 'work-anniversary', name: 'Work anniversary', when: 'Every morning, for anyone completing another year', schedule: 'daily', on: true,
    subject: 'Happy work anniversary, {first_name}! 🎉',
    body: 'Hi {first_name},\n\nToday you complete {years} year(s) with {company}. Thank you for everything you do — here is to many more!\n\n— HR Team' },
  { key: 'broadcast-copy', name: 'Email copy of broadcasts', when: 'When a company update is published', schedule: 'event', on: false,
    subject: '📣 {title}',
    body: 'Hi {first_name},\n\n{message}\n\nAcknowledge it in Broadcasts: {login_url}\n— {company}' },
]
export const automationMeta = (k: AutomationKey) => AUTOMATIONS.find((a) => a.key === k)!
export const defaultAutomations = (): EmailAutomation[] => AUTOMATIONS.map((a) => ({ key: a.key, enabled: a.on, subject: a.subject, body: a.body, sent: 0 }))

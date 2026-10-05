export interface Employee {
  id: string
  name: string
  avatar: string
  role: string
  dept: string
  email: string
  phone: string
  status: 'Active' | 'On Leave' | 'Probation'
  joinDate: string
  rating: number
  salary: number
  bank: {
    bankName: string
    accountNo: string
    ifsc: string
    pan: string
    uan: string
  }
  personal: {
    dob: string
    gender: string
    address: string
    emergencyContact: string
    maritalStatus: string
  }
  documents: { name: string; type: string; date: string; size: string }[]
}

export interface Intern {
  id: string
  name: string
  avatar: string
  domain: string
  mentor: string
  progress: number
  stipend: number
  duration: string
  status: 'Learning' | 'Ready to Convert' | 'Completed'
}

export interface Candidate {
  id: string
  name: string
  avatar: string
  role: string
  experience: string
  appliedDate: string
  stage: 'Applied' | 'Screening' | 'Interview' | 'Selected' | 'Joined' | 'On Hold' | 'Rejected'
  score: number
  rating?: number
}

export interface LeaveRequest {
  id: string
  employeeName: string
  employeeRole: string
  avatar: string
  dept: string
  leaveType: 'Casual Leave' | 'Sick Leave' | 'Earned Leave' | 'Loss of Pay'
  days: number
  startDate: string
  endDate: string
  reason: string
  status: 'Pending' | 'Approved' | 'Rejected'
}

export interface Announcement {
  id: string
  title: string
  date: string
  priority: 'High' | 'Medium' | 'Low'
  content: string
  readCount: number
  totalCount: number
}

export const INITIAL_EMPLOYEES: Employee[] = [
  {
    id: 'EMP-1001',
    name: 'Riya Mehta',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=120&auto=format&fit=crop&q=80',
    role: 'Sales Executive',
    dept: 'Sales',
    email: 'riya.mehta@pokiee.com',
    phone: '+91 98765 43210',
    status: 'On Leave',
    joinDate: '12 Jan 2024',
    rating: 4.8,
    salary: 48000,
    bank: {
      bankName: 'HDFC Bank Ltd',
      accountNo: '•••• •••• 8492',
      ifsc: 'HDFC0001234',
      pan: 'ABCDE1234F',
      uan: '100928374612',
    },
    personal: {
      dob: '14 Aug 1998',
      gender: 'Female',
      address: '402, Lotus Orchid, Bandra West, Mumbai',
      emergencyContact: '+91 98220 11223 (Father)',
      maritalStatus: 'Single',
    },
    documents: [
      { name: 'Offer Letter.pdf', type: 'PDF', date: '10 Jan 2024', size: '240 KB' },
      { name: 'Govt ID Proof.pdf', type: 'PDF', date: '12 Jan 2024', size: '1.2 MB' },
      { name: 'Degree Certificate.pdf', type: 'PDF', date: '12 Jan 2024', size: '3.4 MB' },
      { name: 'Employment Contract.pdf', type: 'PDF', date: '12 Jan 2024', size: '480 KB' },
    ],
  },
  {
    id: 'EMP-1002',
    name: 'Aman Shah',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80',
    role: 'Marketing Lead',
    dept: 'Marketing',
    email: 'aman.shah@pokiee.com',
    phone: '+91 98123 77889',
    status: 'Active',
    joinDate: '01 Mar 2023',
    rating: 4.9,
    salary: 65000,
    bank: {
      bankName: 'ICICI Bank',
      accountNo: '•••• •••• 9921',
      ifsc: 'ICIC0005521',
      pan: 'BCDEF2345G',
      uan: '100882371992',
    },
    personal: {
      dob: '22 Oct 1995',
      gender: 'Male',
      address: 'B-12, Green Avenue, Andheri East, Mumbai',
      emergencyContact: '+91 98111 22334 (Spouse)',
      maritalStatus: 'Married',
    },
    documents: [
      { name: 'Appointment Letter.pdf', type: 'PDF', date: '01 Mar 2023', size: '310 KB' },
      { name: 'Aadhar Card.pdf', type: 'PDF', date: '01 Mar 2023', size: '890 KB' },
      { name: 'Bank Passbook.pdf', type: 'PDF', date: '02 Mar 2023', size: '1.1 MB' },
    ],
  },
  {
    id: 'EMP-1003',
    name: 'Neha Patel',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80',
    role: 'HR Specialist',
    dept: 'Human Resources',
    email: 'neha.patel@pokiee.com',
    phone: '+91 97654 33211',
    status: 'Active',
    joinDate: '15 Jul 2023',
    rating: 4.7,
    salary: 52000,
    bank: {
      bankName: 'Axis Bank',
      accountNo: '•••• •••• 3341',
      ifsc: 'UTIB0002931',
      pan: 'CDEFG3456H',
      uan: '100773918234',
    },
    personal: {
      dob: '05 May 1997',
      gender: 'Female',
      address: '704, Skyline Heights, Powai, Mumbai',
      emergencyContact: '+91 98450 99887 (Mother)',
      maritalStatus: 'Single',
    },
    documents: [
      { name: 'Offer Letter.pdf', type: 'PDF', date: '10 Jul 2023', size: '280 KB' },
      { name: 'PAN Card.pdf', type: 'PDF', date: '15 Jul 2023', size: '650 KB' },
    ],
  },
  {
    id: 'EMP-1004',
    name: 'Rahul Verma',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=120&auto=format&fit=crop&q=80',
    role: 'Frontend Developer',
    dept: 'Engineering',
    email: 'rahul.verma@pokiee.com',
    phone: '+91 98444 55112',
    status: 'Active',
    joinDate: '10 Nov 2023',
    rating: 4.6,
    salary: 58000,
    bank: {
      bankName: 'State Bank of India',
      accountNo: '•••• •••• 4401',
      ifsc: 'SBIN0008891',
      pan: 'DEFGH4567I',
      uan: '100661298451',
    },
    personal: {
      dob: '09 Oct 1996',
      gender: 'Male',
      address: 'Flat 301, Sunshine Park, Thane West',
      emergencyContact: '+91 98333 44556 (Brother)',
      maritalStatus: 'Single',
    },
    documents: [
      { name: 'Offer Letter.pdf', type: 'PDF', date: '05 Nov 2023', size: '260 KB' },
      { name: 'KYC Docs.pdf', type: 'PDF', date: '10 Nov 2023', size: '1.8 MB' },
    ],
  },
  {
    id: 'EMP-1005',
    name: 'Kavya Sharma',
    avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=120&auto=format&fit=crop&q=80',
    role: 'Marketing Associate',
    dept: 'Marketing',
    email: 'kavya.sharma@pokiee.com',
    phone: '+91 98222 33441',
    status: 'Active',
    joinDate: '01 Feb 2024',
    rating: 4.5,
    salary: 42000,
    bank: {
      bankName: 'Kotak Mahindra Bank',
      accountNo: '•••• •••• 1182',
      ifsc: 'KKBK0001822',
      pan: 'EFGHI5678J',
      uan: '100559182374',
    },
    personal: {
      dob: '07 Oct 1999',
      gender: 'Female',
      address: '12A, Palm Beach Road, Vashi, Navi Mumbai',
      emergencyContact: '+91 98110 33445 (Father)',
      maritalStatus: 'Single',
    },
    documents: [
      { name: 'Onboarding Kit.pdf', type: 'PDF', date: '01 Feb 2024', size: '520 KB' },
    ],
  },
  {
    id: 'EMP-1006',
    name: 'Meera Jain',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=120&auto=format&fit=crop&q=80',
    role: 'Finance Officer',
    dept: 'Finance',
    email: 'meera.jain@pokiee.com',
    phone: '+91 98999 11228',
    status: 'Active',
    joinDate: '15 Aug 2023',
    rating: 4.9,
    salary: 55000,
    bank: {
      bankName: 'HDFC Bank Ltd',
      accountNo: '•••• •••• 7712',
      ifsc: 'HDFC0004412',
      pan: 'FGHIJ6789K',
      uan: '100449912831',
    },
    personal: {
      dob: '12 Oct 1994',
      gender: 'Female',
      address: '503, Raj Heritage, Borivali West, Mumbai',
      emergencyContact: '+91 98221 44556 (Spouse)',
      maritalStatus: 'Married',
    },
    documents: [
      { name: 'Offer Letter.pdf', type: 'PDF', date: '10 Aug 2023', size: '250 KB' },
      { name: 'Chartered Acc Docs.pdf', type: 'PDF', date: '15 Aug 2023', size: '2.4 MB' },
    ],
  },
]

export const INITIAL_INTERNS: Intern[] = [
  { id: 'INT-01', name: 'Tanmay Joshi', avatar: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=120&auto=format&fit=crop&q=80', domain: 'UI/UX Design', mentor: 'Parv Shah', progress: 85, stipend: 18000, duration: 'Month 3 of 4', status: 'Ready to Convert' },
  { id: 'INT-02', name: 'Ananya Gupta', avatar: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=120&auto=format&fit=crop&q=80', domain: 'Frontend Development', mentor: 'Rahul Verma', progress: 70, stipend: 20000, duration: 'Month 2 of 3', status: 'Learning' },
  { id: 'INT-03', name: 'Kunal Deshmukh', avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=120&auto=format&fit=crop&q=80', domain: 'Talent Acquisition', mentor: 'Neha Patel', progress: 92, stipend: 15000, duration: 'Month 4 of 4', status: 'Ready to Convert' },
  { id: 'INT-04', name: 'Sneha Rao', avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=120&auto=format&fit=crop&q=80', domain: 'Content & Social', mentor: 'Aman Shah', progress: 60, stipend: 16000, duration: 'Month 2 of 3', status: 'Learning' },
]

export const INITIAL_CANDIDATES: Candidate[] = [
  { id: 'CAN-101', name: 'Pooja Iyer', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=120&auto=format&fit=crop&q=80', role: 'Senior React Engineer', experience: '4.5 Years', appliedDate: 'Today', stage: 'Applied', score: 88 },
  { id: 'CAN-102', name: 'Varun Nair', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80', role: 'HR Business Partner', experience: '3 Years', appliedDate: 'Yesterday', stage: 'Screening', score: 92 },
  { id: 'CAN-103', name: 'Simran Chadha', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80', role: 'Product Designer', experience: '2 Years', appliedDate: '02 Oct', stage: 'Interview', score: 95 },
  { id: 'CAN-104', name: 'Aditya Roy', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=120&auto=format&fit=crop&q=80', role: 'Sales Specialist', experience: '5 Years', appliedDate: '28 Sep', stage: 'Selected', score: 96 },
  { id: 'CAN-105', name: 'Rohit Kulkarni', avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=120&auto=format&fit=crop&q=80', role: 'Backend Node Architect', experience: '6 Years', appliedDate: '25 Sep', stage: 'Joined', score: 98 },
  { id: 'CAN-106', name: 'Priya Sundaram', avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=120&auto=format&fit=crop&q=80', role: 'Data Analyst', experience: '2.5 Years', appliedDate: '20 Sep', stage: 'On Hold', score: 84 },
  { id: 'CAN-107', name: 'Arjun Sen', avatar: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=120&auto=format&fit=crop&q=80', role: 'Junior QA Tester', experience: '1 Year', appliedDate: '15 Sep', stage: 'Rejected', score: 68 },
]

export const INITIAL_LEAVES: LeaveRequest[] = [
  { id: 'LV-101', employeeName: 'Riya Mehta', employeeRole: 'Sales Executive', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=120&auto=format&fit=crop&q=80', dept: 'Sales', leaveType: 'Casual Leave', days: 1, startDate: '06 Oct 2026', endDate: '06 Oct 2026', reason: 'Personal family event', status: 'Pending' },
  { id: 'LV-102', employeeName: 'Aman Shah', employeeRole: 'Marketing', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80', dept: 'Marketing', leaveType: 'Sick Leave', days: 3, startDate: '06 Oct 2026', endDate: '08 Oct 2026', reason: 'Viral fever, resting at home', status: 'Pending' },
  { id: 'LV-103', employeeName: 'Neha Patel', employeeRole: 'HR', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80', dept: 'Human Resources', leaveType: 'Earned Leave', days: 2, startDate: '15 Oct 2026', endDate: '16 Oct 2026', reason: 'Pre-planned travel vacation', status: 'Pending' },
]

export const INITIAL_ANNOUNCEMENTS: Announcement[] = [
  { id: 'ANN-01', title: 'Office Holiday - Diwali', date: 'Oct 04, 2026', priority: 'High', content: 'Our offices will remain closed from Oct 24 to Oct 27 for Diwali celebrations. Wishing everyone light and joy!', readCount: 118, totalCount: 125 },
  { id: 'ANN-02', title: 'New Attendance Policy', date: 'Oct 03, 2026', priority: 'Medium', content: 'Grace period for morning punch-in is updated to 9:45 AM. 3 late arrivals in a month will now be reviewed with team leads.', readCount: 102, totalCount: 125 },
  { id: 'ANN-03', title: 'Team Outing this Friday!', date: 'Oct 02, 2026', priority: 'Low', content: 'Join us for fun arcade games, bowling and team dinner this Friday evening at Smaaash!', readCount: 125, totalCount: 125 },
]

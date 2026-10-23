-- =====================================================================================================
-- Rexera CRM · Sales Kit (schemes, benefits, eligibility, last date, charges) — everyone reads it, only the Operation
-- team (and Super Admin / IT) edits it. Starts with the 55 schemes from Sales Kit.xlsx. Safe to run more than once.
-- =====================================================================================================
create table if not exists sales_kit (
  id                  text primary key,
  category            text not null,
  position            int not null default 0,
  name                text not null,
  benefits            text not null default '',
  sectors             text not null default '',
  eligibility         text not null default '',
  last_date           text not null default '',          -- a date or "Rolling basis"
  organisation        text not null default '',
  scheme_type         text not null default '',
  applicable_for      text not null default '',
  min_charge          text not null default '',
  registration_charge text,
  updated_at          timestamptz,
  updated_by          text references app_users(id) on delete set null
);
create index if not exists sales_kit_category_idx on sales_kit(category, position);
alter table sales_kit enable row level security;
drop policy if exists sales_kit_read on sales_kit;
create policy sales_kit_read on sales_kit for select to authenticated using (true);
drop policy if exists sales_kit_write on sales_kit;
create policy sales_kit_write on sales_kit for all to authenticated using (app.has_perm('saleskit.manage')) with check (app.has_perm('saleskit.manage'));

insert into role_permissions (role, permission) values ('operations', 'saleskit.manage') on conflict do nothing;

-- the list as given (rows already there are left as the team edited them)
insert into sales_kit (id, category, position, name, benefits, sectors, eligibility, last_date, organisation, scheme_type, applicable_for, min_charge, registration_charge) values
  ('sk-grant-01', 'Grant', 1, 'Global Impact Challenge', '>>Stage 1 (Pilot): Grant up to ₹1.5 Cr (USD 200K)
>>Stage 2 (Test & Scale Readiness): Grant up to ₹4.5 Cr (USD 500K)
>>Stage 3 (Scale): Grant up to ₹14 Cr (USD 1.5M)', 'Socially Impactful areas
● Agriculture/Food Security
● Democracy/Rights/Governance
● Economic Growth
● Education and Training
● Energy
● Environment
● Health
● Water Sanitation and Hygiene', 'Private Limited
LLP
Partnership
OPC
Public Limited
Proprietorship
Non-profits
Section 8, NGO
Foundation', 'Rolling basis', 'DIV Fund', 'International Organization', 'Pan India', 'INR 15,000 + 18% GST', null),
  ('sk-grant-02', 'Grant', 2, 'Fisheries Grant', 'Grant up to 10 Lakhs (Standard)
and Grant up to 50 Lakhs (Exceptional)', '● Agriculture/Food Security
● Democracy/Rights/Governance
● Economic Growth
● Education and Training
● Energy
● Environment
● Health
● Water Sanitation and Hygiene', 'Companies and private enterprises developing relevant products or technologies.
Academic and research institutions conducting applied research.
Government institutions working on relevant projects.
Non-governmental organisations (NGOs) and nonprofit organisations.
Individual innovators, researchers, and entrepreneurs.', '18 Nov 2026', 'Interventions to Improve the Welfare of Farmed Fishes', 'FWI', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-grant-03', 'Grant', 3, 'Elevate Minority (KA)', 'Grant-in-aid of up to ₹50 lakh.', 'Information Technology and Digital Solutions
Artificial Intelligence and Emerging Technologies
Healthcare and Lifesciences
AgriTech and FoodTech
Clean Energy and Sustainability
Electric Mobility and Transportation
Manufacturing and Industrial Innovation
Education and Social Impact Solutions
FinTech and Business Technology', 'Startups incorporated in Karnataka as a Private Limited Company, One Person Company (OPC), Registered Partnership Firm, LLP or eligible Cooperative Society.
Startups incorporated within the last 10 years.
Startups with turnover not exceeding ₹200 crore in any financial year since incorporation.
At least 51% equity must be held by eligible minority-community director(s) or partner(s).
Applicants must not have received an ELEVATE grant in the previous three years.', '12 Nov 2026', 'Department of Electronics, IT & BT', 'Government of Karnataka', 'Karnataka', 'INR 15,000 + 18% GST', null),
  ('sk-grant-04', 'Grant', 4, 'Elevate Nxt (KA)', 'Grant-in-aid of up to ₹1 crore', 'Artificial Intelligence (AI), Machine Learning and Generative AI
Quantum Technologies
Semiconductors and Microelectronics
Robotics, IoT and Industrial Automation
Space, Aerospace and Defence
Cybersecurity and Secure Systems
Electric Mobility, Logistics and Transportation
Energy and Climate Technology
AgriTech and FoodTech
Healthcare, Biotechnology and Lifesciences
FinTech
Nanotechnology and Advanced Materials', 'Startups registered as a Private Limited Company, Registered Partnership Firm, LLP or eligible Cooperative Society.
Startups incorporated within the last 20 years.
Startups with turnover not exceeding ₹300 crore in any financial year since incorporation.
Startups developing DeepTech innovations with a Technology Readiness Level (TRL) between 3 and 8.
Startups registered outside Karnataka must shift their registered office to Karnataka within four months of the result announcement if selected.', '12 Nov 2026', 'Department of Electronics, IT & BT', '', 'Karnataka', 'INR 15,000 + 18% GST', null),
  ('sk-grant-05', 'Grant', 5, 'CSR Grant for Health Tech Startups', 'Grant up to 8 Lakhs', 'Digital health
Artificial intelligence in healthcare
Health information systems
Healthcare monitoring solutions
ICT-enabled healthcare innovations', 'Early-stage startups working in the health technology sector.
Indian startups registered with the DPIIT.
Startups developing innovative healthcare solutions with an ICT component.', '30 Oct 2026', '', '', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-grant-06', 'Grant', 6, 'Elevate North-East 2.0', 'Non Refundable Grant up to ₹ 80 Lakh', 'All Sectors', '· Private Limited Company / OPC
· LLP
· Partnership
· Proprietorship

Companies from North Eastern states as well as all India can apply but their product or service should have impact on North-East India (Arunachal Pradesh, Assam, Manipur, Meghalaya, Mizoram, Nagaland and Tripura).', '14 Nov 2026', 'AIC SMU', 'Government authorised incubator', 'North Eastern States and Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-grant-07', 'Grant', 7, 'Grand Startup Challenge - 2026', 'Up to INR 1 Cr total', 'Lending & Fintech
Mobility & Road Safety
Supply Chain
Sovereign AI', 'Early-stage startups incorporated in India, as a private limited company or an LLP, with at least one founder working on it full-time.
If you have raised more than ₹50 crore in funding, the challenge is not for you.', '09 Nov 2026', 'DPIIT and Meity Hub', 'Startup India Challenge', 'pan India', 'INR 5,000 + 18% GST', null),
  ('sk-grant-08', 'Grant', 8, 'Funding Support (UP)', 'Seed Capital Assistance: Up to ₹15 lakh; up to ₹50 lakh in special cases
Sustenance Allowance: ₹20,000/month for up to 2 years
Prototype Grant: Up to ₹10 lakh
Matching Grant: 50% of eligible funds raised, up to ₹5 crore
Additional support may be available for certain eligible categories and deep-tech startups', 'All sectors', 'DPIIT registered Uttar Pradesh based

Private Limited
LLP
Registered Partnership', 'Rolling basis', 'Govt of Uttar Pradesh', 'Government Scheme', 'Uttar Pradesh', 'INR 10,000 + 18% GST', null),
  ('sk-grant-09', 'Grant', 9, 'Agri-Tech Innovation Grant', '>Maximum Grant Amount: ₹7,50,000
>Funding Type: Non-repayable grant (subject to compliance)
>Disbursement: Milestone-based installments', 'A. Advanced Farming Technologies
B. Agri Product Innovation
C. Cold Storage & Infrastructure
D. Digital Agriculture (Software & Applications)
E. Supply Chain & Delivery Innovation', '>Individual farmers and farmer groups
>Farmer Producer Organizations (FPOs)
>Agri-startups and innovators
>Proprietorships, partnerships, and registered companies
>Technology developers working in agriculture', 'Rolling basis', 'Vibrant India Innovation Hub', 'Government Sponsored Scheme', 'Pan India', 'INR 20,000 + 18% GST', null),
  ('sk-grant-10', 'Grant', 10, 'RKVY RAFTAAR', '1) Idea stage (grant support up to Rs. 5.00 Lakh)
2) Seed Stage (grant support up to Rs. 25.00 Lakh)', 'AgriTech
Animal Husbandry
Dairy and Food Technology
Agri Waste Management
Agri Biotech
Natural Resource Management', '1.Registered Partnership, LLP, Pvt. Ltd, OPC, Sole Proprietorship and Individual
2.Start-ups with at least Minimum Viable Product (MVP).
3.A startup supported once will not be eligible for applying for the subsequent round of seed support.
4. One month of incubation is compulsory after selection.', 'Rolling basis', 'Ministry of Agriculture and Farmers'' Welfare, Govt of India', 'Government Scheme', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-grant-11', 'Grant', 11, 'GUJARAT GRANT', '> Grant support: Up to ₹30 lakh
> Assistance to Startups: Up to ₹10 lakh
> Sustenance allowance: ₹20,000/month for one year (₹25,000 for women)
> Skill development: Up to ₹1 lakh
> Acceleration program assistance: Up to ₹3 lakh
> Pre-Series A Funding: ₹50 lakh to ₹3 crore
> Interest Subsidy: 1% to 9% interest subsidy, on term loans', 'All Sector', 'LLP, Pvt Ltd, & Partnership can apply
This scheme is applicable to Gujarat State only
The applicant does not own more than 10% in any other company.', 'Rolling basis', 'GUIITAR Council', 'Government Authorized Incubator Scheme', 'Gujarat Only', 'INR 30,000 + 18% GST', null),
  ('sk-grant-12', 'Grant', 12, 'Srujan Scheme (Guj)', '> Grant of 2.5 to 10 Lakhs', 'All Sector', 'Any innovator or startup founder age under 35 years who is:

1) Any Gujarati student Middle/Secondary (up to Class 12), Diploma, Vocational, Undergraduate, Postgraduate, or Doctoral programs, as well as any dropout from a Gujarati school, institution, or university
2) Only Gujarat-based startups can apply', 'Rolling basis', 'I hub', 'Government Authorized Incubator Scheme', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-grant-13', 'Grant', 13, 'Young Innovators Grant', '> Up To INR 20 Lakh Grant', 'Sector-agnostic (all sectors) funding to foster diverse and innovative ideas.', 'Person, who’s aged up to 25 years or under from across India,', 'Rolling basis', 'Zerodha', 'Private Investor scheme', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-grant-14', 'Grant', 14, 'NIDHI Prayas', '> Non Refundable grant support up to Rs. 10 Lakh', 'Healthcare
Manufacturing
Agriculture
Energy
IoT
Cleantech
Other Technology Areas', 'An early stage businesses are eligible in NIDHI PRAYAS (Individual, Proprietorship, LLP, Pvt Ltd, Registered Partnership)
The startup should not be more than 7 years of existence.
The startup should not have annual turnover exceeding Rs. 25 lakhs for any of the financial years since its inception.', 'Rolling basis', 'Department of Science & Technology', 'Government Scheme', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-grant-15', 'Grant', 15, 'Innovation Grant (KL)', '1. Idea Grant: Grant of upto INR 3 lakhs.
2. Productization Grant: Grant of upto INR 7 lakhs
3. Market Acceleration Grant: Grant of upto INR 10 lakhs
4. Scale-up Grant: Grant of upto INR 15 lakhs
5. R&D Grant: Grant of INR 30 lakhs
6. Idea Grant (Student Innovator): Grant of upto INR 2 lakhs
7. Women/Transgender Productization Grant: Grant of upto INR 12 lakhs.', 'All Sector', '1) PVT LTD/LLP/OPC can apply for productization, Market Acceleration, Scale-up and Women/ Transgender Productization and R&D Grant
2) Individuals have unique Idea can apply for Idea Grant
3) Only Kerala based startups can apply
4) For Idea, Productization, Market Acceleration, Scale-up and Women/Transgender Productization Gran: KSUM unique ID certificate is compulsory
5) For R&D Grant: KSUM unique ID and DIPP certificate are compulsory', 'Rolling basis', 'Govt of Kerala, Kerala Technology Startup Policy', 'Government Scheme', 'Kerala State Only', 'INR 25,000 + 18% GST', null),
  ('sk-grant-16', 'Grant', 16, 'NGO Kickstarter', 'Grant support of up to ₹15 Lakh', 'The focus depends on the selected city:

Ahmedabad: Urban Livelihoods, Rural Livelihoods
Bengaluru: Urban Livelihoods, Disability/Special Needs, Waste Management
Delhi NCR: Urban Livelihoods
Hyderabad: Urban Livelihoods, Rural Livelihoods, Healthcare, Disability/Special Needs, Waste Management
Kolkata: Urban Livelihoods, Rural Livelihoods, Disability/Special Needs
Mumbai: Urban Livelihoods, Healthcare, Disability/Special Needs, Waste Management
Pune: Urban Livelihoods, Rural Livelihoods, Healthcare, Disability/Special Needs
Chennai: Urban Livelihoods, Rural Livelihoods, Healthcare, Disability/Special Needs .', 'Eligible NGOs that:

Have a valid 12A and 80G certificate.
Have been operating for at least 3 years.
Have projects based in one of the supported chapter cities.
Work within the focus areas of the selected city', 'Rolling basis', 'SVP India', 'National Level Organization', 'Selected areas as per focus sector', 'INR 10,000 + 18% GST', null),
  ('sk-grant-17', 'Grant', 17, 'Tide 2.0', 'Grant of up to INR 7 Lakh.', 'ICT, Agri-Tech/Food-Tech, Social Impact
, Health-Tech, Green Energy Fintech Women-Led, EV, Clean-Teach, Infrastructure & Transportation, SaaS', 'Pvt. Ltd, LLP, Reg Partnership and Sole Proprietorship
Startup at Revenue Stage or Market Ready Stage
Registered as a legal entity at the time of application', 'Rolling basis', 'TIDE 2.0', 'Government Scheme', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-grant-18', 'Grant', 18, 'Growth Grant', '> Non- refundable Grant up to ₹ 1.7 Cr [$200,000]', 'All Sectors', '1. Applicants must be aged 22 or younger at the time of application

2. Must not hold a university degree and should be ready to drop out or defer enrollment if selected

3. Should be working on a high-impact idea with early traction or a strong vision', 'Rolling basis', 'Thiel Foundation, California', 'International Organization', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-grant-19', 'Grant', 19, 'Socialpreneur Grant', 'Grant up to ₹ 12.5 Lakh', 'Youth Employment Innovation
Future-Ready Skills Development
Entrepreneurship & Self-Employment
Rural Income Enhancement
Inclusive Economic Participation', 'Private Limited, LLP, Partnerships
Proprietorships
Section 8, Foundations
Non registered or team
Minimum 1 year of operations
Impact-first venture with potential to impact at least 3 UN Sustainable Development Goal', 'Rolling basis', 'NSRCEL, the startup hub at IIM Bangalore, in collaboration with Capgemini', 'Government Authorized Incubator and Private CSR based Fund', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-grant-20', 'Grant', 20, 'IVP (TN)', '> Voucher A: Grant upto Rs. 3 lakhs for converting the Idea into a working Prototype

> Voucher B: Grant up to Rs. 7 lakh for commercialization support.', '1. Agriculture,
2. Environment,
3. Energy
4. Horticulture,
5. Veterinary,
6. Fisheries
7. Engineering,
8. Waste Management,
9. Health
10. Automobiles,
11. Nanotechnology,
12. Electronics,
13. Deep Technology
14. Etc', '1. Should be a manufacturing MSME.
2. Be registered and located in Tamil Nadu.
3. Willing to co finance the innovation investment as per IVP norms.
4. Should have a CIBIL score of 750 or more.', 'Rolling basis', 'Government of Tamil Nadu', 'Government Scheme', 'Pan India', 'INR 5,000 + 18% GST', null),
  ('sk-grantdebtequity-01', 'Grant + Debt + Equity', 1, 'Sprint Yojna', '1) Maximum funding support of up to INR 25 lakhs per startup (Grant/debt/equity, any)
2) Link to investment ventures and angel fund community
3) Support from Prototype to product launch
4) Partnership, Collaboration and Connects
5) Testbed and support in joint technology Development
6) Deployment of Market ready products
7) Support in exploring Global Market
8) Customized Training & Mentoring
9) Support in Tech commercialization
10) Technology enhancement for pre-launched Products', '> Agriculture Science / Agriculture Engineering
> Biotechnology / Life science/ Health tech/ Med tech
> Water Management, and Technology
> Interdisciplinary Cyber-Physical Systems
> IoT / Deep-tech / Hardware Tech / Tech Focused
> Sustainable Development Goals', '1. Recognized startups
2. Sole Proprietorship, Limited Liability Partnership (LLP), One Person Company (OPC), Private Limited (Pvt Ltd), Foreign Collaboration, Not Registered can apply
3. Granted patents and deep tech innovations are encouraged
4. Focus on Cyber-Physical Systems (CPS)
5. Women founders are highly encouraged to apply
6. Generating revenue are encouraged
7. Stages of Startup: Ideation, PoC / Prototype, Minimum Viable Product (MVP) and Commercialized
8. Already raised past investments will be edge over others', 'Rolling basis', 'IIT Ropar', 'Government Authorized Incubator Scheme', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-grantdebtequity-02', 'Grant + Debt + Equity', 2, 'Pro-Fund Support', '> Funding support from ₹2 lakhs to ₹30 Lakhs, depending on eligibility.', '> All Sectors', '1. Any registered entity can apply, such as a Proprietorship, Partnership, LLP, Pvt Ltd
2. Individuals can also apply.', 'Rolling basis', 'i-Create', 'Government Authorized Incubator Scheme', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-grantdebtequity-03', 'Grant + Debt + Equity', 3, 'Fund for Agri (MH)', 'Funding opportunities up to INR 1 Cr, as per the project/ask (grant/debt/equity, subject to the revenue meeting and to be decided by the evaluating committee)', 'Agri-Tech', 'Maharashtra based all Startups

Only Pvt Ltd, LLP and Not for Profit can apply', 'Rolling basis', 'MCCIA & Mr Ajinkya Rahane', 'Government Authorized NGO + Private Investor Scheme', 'Only Maharashtra based', 'INR 10,000 + 18% GST', null),
  ('sk-grantdebtequity-04', 'Grant + Debt + Equity', 4, 'Excel Your Venture', 'Financial Support Up to INR 42 Lakhs (USD 50,000) for every startup supported', 'Fintech
Livelihood, Job & Skilling', 'Registered businesses in India can app;y
Exceptional individuals starting off with promising ideas on financial inclusion are also welcome', 'Rolling basis', 'IIMA Venture', 'Government Authorized Incubator Scheme', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-grantdebtequity-05', 'Grant + Debt + Equity', 5, 'BI Initiative Bharat Inclusion Initiative', 'Financial Support Up to INR 42 Lakhs (USD 50,000) for every startup supported', 'Fintech
Livelihood, Job & Skilling', 'Registered businesses in India can app;y
Exceptional individuals starting off with promising ideas on financial inclusion are also welcome', 'Rolling basis', 'IIMA Venture', 'Government Authorized Incubator Scheme', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-debtequity-01', 'Debt + Equity', 1, 'Defence Fund', 'USD $400,000 (Up to INR 3.6 Cr) in pre-seed/seed funding for each selected startup (equity or debt-equity-linked instruments).
Technical & Product Support & Global Market Insights & Access', 'Defence & aerospace
> Autonomy & Onboard Intelligence
> Secure Communications & Strategic Systems
Propulsion & In-space / Aerospace technologies
> Advanced Manufacturing
> High-performance & Advanced Materials', 'Early-Stage Innovators
Startups at the pre-seed or seed stage
For-profit entities: Proprietorship, Partnership, Pvt Ltd, LLP, Unregistered (they need to register)', 'Rolling basis', 'IIMA Venture & Jaivel Aerospace', 'Government Authorized Incubator Scheme', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-debtequity-02', 'Debt + Equity', 2, 'Titanium Fund', 'Funding support up to ₹50 Lakh
Mentorship from IIT Bombay faculty, industry experts and domain specialists
Access to advanced R&D infrastructure, labs and prototyping facilities
Industry connect, investor network and business development support
Support in technology validation, intellectual property and commercialisation', 'Advanced Materials
Electronics & Semiconductors
Advanced Manufacturing
Clean Energy & Sustainability
Biotechnology & Life Sciences
Al, Robotics & Emerging Tech', 'India-registered startup (Private Limited)
Technology in deep tech/science-based domain
Early-stage startups with strong technology IP
Clear plan for product development & commercialisation
Commitment from founding team to actively work on the venture
Other criteria as specified in the program guidelines', '30 Oct 2026', 'SINE,IIT Bombay', '', 'Pan India', 'INR 5,000 + 18% GST', null),
  ('sk-debtequity-03', 'Debt + Equity', 3, 'Climate Tech', '1) Funding support of up to INR 40 Lakh (Equity/Debt)

2) Mentoring by experts, market and investor connects', 'ClimateTech Solutions
Circular Economy Initiatives', 'Registered Partnerships
Limited Liability Partnership (LLP)
Private Limited (Pvt Ltd)', 'Rolling basis', 'IIM Venture Ahmedabad', 'Government Authorized Incubator Scheme', 'Pan India', 'INR 15,000 + 18% GST', null),
  ('sk-debtequity-04', 'Debt + Equity', 4, 'Start up Support Scheme SSS', '₹25 Lakh to ₹1 Crore
Please Note: It may be equity-linked instruments like equity/CCD/CCPS/Debt', 'Agriculture,
Healthcare,
Manufacturing,
Engineering,
IoT,
biotechnology,
Medical devices,
Water,
Waste management,
Energy,
Climate tech,
Fintech
etc.', '• Proprietorship/ Partnership/ LLP/ Pvt Ltd companies
• Must be at - Idea stage / PoC stage / Prototype stage / MVP stage/ Scaleup stage
• Must be incorporated within the last 10 years
• The idea must be related to technology and innovation.', 'Rolling basis', 'Department of Science & Technology', 'Government Scheme', 'Pan India', 'INR 20,000 + 18% GST', null),
  ('sk-debtequity-05', 'Debt + Equity', 5, 'Sustainability Sprint', '1) Funding support of up to INR 40 Lakh (Equity/Debt)

2) Mentoring by experts, market and investor connects', 'ClimateTech Solutions
Circular Economy Initiatives', 'Registered Partnerships
Limited Liability Partnership (LLP)
Private Limited (Pvt Ltd)', 'Rolling basis', 'IIM Venture Ahmedabad', 'Government Authorized Incubator Scheme', 'Pan India', 'INR 15,000 + 18% GST', null),
  ('sk-equity-01', 'Equity', 1, 'Evolve-Tech Funding', 'Funding up to ₹ 30 Lakh in exchange of 5% of Equity.', 'All sectors', 'DPIIT Recognized Startups (Reg Partnership, LLP, OPC, Pvt Ltd)

Tech-enabled startup seeking private funding

Revenue generating startups (compulsory)', 'Rolling basis', 'WeFounderCircle', 'Private Investor Scheme', 'Pan India', 'INR 20,000 + 18% GST', null),
  ('sk-equity-02', 'Equity', 2, 'Velocity Fund', 'Investment support of up to ₹ 9 Cr', 'Technology startups
Scalable digital solutions
Innovation-driven ventures
AI and emerging technologies
Global high-growth startups', 'Private Limited
LLP
Partnership
Limited Company', 'Rolling basis', 'a16z and Speedrun investors', 'Private Investor Scheme', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-equity-03', 'Equity', 3, 'Venture Fund for Defence & Aerospace', 'Equity based funding as per project cost (Max up to ₹50 Cr)', '> Defence
> Aerospace', '• Private Limited Companies
• Public Limited Companies
• The company shall fall in the definition of Start-up as defined by Start-up initiative of Govt. of India or MSME as per the Ministry of MSME/Micro, Small and Medium Enterprises Development Act, 2006.
• The entrepreneur and all operations of the business should be domiciled in the state of Maharashtra.', 'Rolling basis', 'Maharashtra Industrial Development Corporation and IDBI Trusteeship Services Limited', 'CSR involved program', 'Maharashtra', 'INR 10,000 + 18% GST', null),
  ('sk-equity-04', 'Equity', 4, 'Agri-Sure Fund', 'Equity based fund upto a maximum of up to ₹25 crore in one Start-up, subject to AIF (Alternative Investment Funds) Regulations.', '1. Agritech,
2. Food Processing,
3. Animal Husbandry,
4. Fisheries,
Other Agri and related areas', 'Start-ups recognized by DPIIT and incorporated in India.', 'Rolling basis', 'Ministry of Agri and Farmer Welfare & NABARD', 'Govt Scheme', 'Pan India', 'INR 20,000 + 18% GST', null),
  ('sk-equity-05', 'Equity', 5, 'Fintech Bridge', 'Investment up to $1 Million USD (upto ₹ 8 Cr)', 'Fintech', 'Registered as a Private Limited with a DPIIT Certificate

Revenue Generating Startups', 'Rolling basis', 'AIC RNTU', 'Government Authorized Incubator Scheme', 'Pan India', 'INR 15,000 + 18% GST', null),
  ('sk-equity-06', 'Equity', 6, 'Equity Elevator', 'Financial Benefits: Equity-based investment up to ₹ 4 Cr (USD 5,00,000)
Mentoring & Networking Support
In person guidance from experts at San Francisco', 'All Sectors', 'All registered entities / Solo entrepreneurs', 'Rolling basis', 'Y Combinator', 'Private Investor Scheme', 'World Wide', 'INR 20,000 + 18% GST', null),
  ('sk-equity-07', 'Equity', 7, 'Genesis Pilot 2.0', 'Funding up to ₹40 Lakhs', 'Electronic design and manufacturing
Deeptech (AI, IoT, robotics-based, other emerging areas) software and product
Information and Communication Technology (ICT) space
Other emerging and technological areas', 'DPIIT-recognised startups incorporated in a Tier 2 or Tier 3 city, 1-5 years old, with Indian founders holding at least 51%.
An MVP or working prototype, and at least one full-time founder.
A Pilot PO/WO of ₹1 lakh–₹1 crore from an eligible, independent Pilot Partner, covering deployment of the startup''s own product.
Cumulative revenue up to ₹1.5 crore.
Prior government funding up to ₹40 lakh and prior private funding up to ₹1.5 crore.
Beneficiaries of TIDE 2.0 (Scale-up), SAMRIDH or the GENESIS Investment Component, and startups in an ongoing GENESIS EIR cohort, are not eligible.
MSH & MeitY reserve the right to amend or modify the selection procedure, as deemed necessary.', '29 Oct 2026', 'Meity', 'Govt Scheme', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-equity-08', 'Equity', 8, 'VC Fund (KA)', 'Fund Type A
Range of INR 50 lakhs to 1 Cr.
upto INR 2 Cr at a later stage / follow-on investment

Fund Type B
Range of 2 to 3 Cr
& later stage follow-on investment.', 'Fund Type A
Animation, visual effects, Gaming, Comics, Media, Original IP Content and such other allied sectors

Fund Type B
AI, ML, MedTech, EV
Other Disruptive Technologies', 'Startups having registered entities with CIN Number (CIN number compulsory)', 'Rolling basis', 'Kitven Fund', 'Private Investor Scheme', 'Karnataka Only', 'INR 15,000 + 18% GST', null),
  ('sk-equity-09', 'Equity', 9, 'Cutting-Edge Inception', 'Expertise

Technological Support

Venture Capital Connects for private funding

Awareness: Access to exclusive NVIDIA Inception events', 'AI, ML, deep learning, data science, HPC, networking, graphics, AR/VR, and gaming and any other IT, IOT, AI powered solutions where CPU, DPU & NVIDIA play a vital role', 'At least one developer and one founder/co-founder, C-level executive (like CEO, CFO, CMO, etc), sales executive, or marketing executive.

Your startup needs to maintain a functional website live.

Your startup needs to be incorporated and have been incorporated in the last 10 years. (Proprietorship, Reg partnership, LLP, Private Limited, other registered)', 'Rolling basis', 'NVIDIA', 'Private Investor Scheme', 'Pan India', 'INR 5,000 + 18% GST', null),
  ('sk-equity-10', 'Equity', 10, 'Equity Linked Seed Fund', 'Investment of up to INR 30 Lakhs

Investment based in Equity or Equity linked (Equity linked means, debt-equity combined).

Equity based investment of up to 10% Equity stake', 'Biotech in agri, health, energy, environment and other emerging areas', 'Only Pvt Ltd companies are eligible
A company shall be considered as start up DPIIT
Up to 5 years from the date of its incorporation/registration
Turnover for any of the financial years has not exceeded Rs 25 cr', 'Rolling basis', 'BIRAC and Govt Authorized INCUBATORS', 'Government Authorized Incubator Scheme', 'Pan India', 'INR 15,000 + 18% GST', null),
  ('sk-equity-11', 'Equity', 11, 'Fund for SC/ST Entrepreneurs', 'Equity based funding as per project cost (Max up to ₹5 Cr)', '> Manufacturing based businesses (All Sectors)
> Service based businesses (Health Care, Renewable and Non-Conventional Energy, Agri ancillary, Food Processing, Energy efficiency – transmission – distribution, Clean Technology, Light Engineering, Information Technology, Medical Devices, Water and related technologies, Bio-Medical , and Consumption lead sectors)', '• Proprietor Unit
• Partnership firm
• Private Limited Companies
• Public Limited Companies
• SC/ST Promoters having 100% controlling stake in the Company
• The company shall fall in the definition of Start-up as defined by Start-up initiative of Govt. of India or MSME as per the Ministry of MSME/Micro, Small and Medium Enterprises Development Act, 2006.
• The entrepreneur and all operations of the business should be domiciled in the state of Maharashtra.', 'Rolling basis', 'Maharashtra Industrial Development Corporation and IDBI Trusteeship Services Limited', 'CSR involved program', 'Maharashtra', 'INR 10,000 + 18% GST', null),
  ('sk-loan-01', 'Loan', 1, 'CGSS Scheme', '1. The maximum amount of debt (fund-based or non-fund-based facilities) eligible for guarantee cover under the Scheme is up to ₹20 crore per borrower.
2. The Trust shall provide guarantee cover, subject to a maximum of Rs. 20 crore per borrower, as per the details given below:
 85% of the amount in default for loan amount up to Rs. 10 crore
 75% of the amount in default for loan amount exceeding Rs. 10 crore
3. RoI and repayment tenure as per bank norms', 'All Sectors', '1. The DPIIT recognizes startup (Reg. Partnership, LLP & Pvt Ltd) as per gazette notification(s) issued from time to time;
2. It is not in default to any lending/investing institution and is not classified as a Non-Performing Asset as per the guidelines of the Reserve Bank of India (RBI)', 'Rolling basis', 'DPIIT', 'Government Scheme', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-loan-02', 'Loan', 2, 'Mudra Loan', 'Shishu Category: Up to Rs. 50,000

Kishore Category: Rs. 50,001 to Rs. 5 Lakhs

Tarun Category: Rs. 5 Lakhs to Rs. 10 Lakhs

Tarun Plus: Loans sanctioned under the PMMY scheme Rs. 10 Lakhs up to Rs. 20 Lakhs (Only for those who have successfully repaid their Tarun category Loans)', 'Trading
Manufacturing
Service Sector', 'Anyone with individual docs , MSME Certificate', 'Rolling basis', 'Ministry Of Finance', 'Government Scheme', 'Pan India', 'INR 5,000 + 18% GST', null),
  ('sk-loan-03', 'Loan', 3, 'CGTMSE', 'Up to 10 CR Loan
ROI: Approx 7%-12%
Tenure: Depends on loan amount', 'Manufacturing and services', 'Any for profit registered entity with MSME Certificate and 1/2 years Company ITR', 'Rolling basis', 'MSME', 'Government Scheme', 'Pan India', 'INR 10,000 + 18% GST', null),
  ('sk-loan-04', 'Loan', 4, 'Seed Fund (KL)', 'Seed Fund of Rs.15 Lakhs at a subsidised interest rate of 6% per annum for Both Components in Seed Fund (KL).', 'All Sectors', 'Startup Approved by DPIIT and get Kerala Startup Mission Unique ID.

The startup director should have a good CIBIL Score, preferably more than 750.

Kerala based startup can apply', 'Rolling basis', 'Govt of Kerala', 'Government Scheme', 'Kerala State Only', 'INR 15,000 + 18% GST', null),
  ('sk-loan-05', 'Loan', 5, 'Financial Assistance for SC, ST & OBC', 'Loan INR 10 Lakh to ₹ 15 Cr. for SC
for SC(ROI: 4%, For women and Divyang: 3.75%)
Loan INR 10 Lakh to ₹ 5 Cr. for ST
for SC(ROI: 4%, For women and Divyang: 3.75%
Loan INR 20 Lakh to ₹ 15 Cr. for OBC
for OBC(ROI: 6%, For women and Divyang: 5.75%)', 'All Sectors

Non eligible companies:
Trading Company, Liquor, Commercial Vehicle, Dealership Businesses, Retailers, Petrol Pumps, School/College/Hospital, etc', '1. The company age should be more than 1 year.
2. Only Private\Public Limited Companies having CIN number.
3. A new company that is a successor entity of a Business entity (Proprietary Firm / Partnership Firm / One Person Company (OPC) / Limited Liability Partnership (LLP) / any other establishment incorporated under any law in force) meeting the above criteria with sound business model.
A maximum of 20% working capital is allowed out of the total financial assistance.', 'Rolling basis', 'Ministry of Social Justice and Empowerment', 'Government Scheme', 'Pan India', 'INR 30,000 + 18% GST', null),
  ('sk-loansubsidy-01', 'Loan + Subsidy', 1, 'Udyam Kranti Yojana (MP)', 'Loans ranging from ₹1,00,000 to ₹50,00,000 will be provided to the youth setting up manufacturing units and enterprises and ₹1,00,000 to ₹25,00,000 for the service sector

3% per annum interest subsidy', 'Manufacturing

Service

Retail Trade', '1. The age of the applicant should be between 18 to 45 years.

2. The minimum educational qualification of the applicant should be 8th class.

3. The benefit of this scheme will be provided to the applicant only if the annual income of the applicant''s family is Rs 12 lakh or less.', 'Rolling basis', 'Govt. of Madhya Pradesh', 'Government Scheme', 'Madhya Pradesh', 'INR 15,000 + 18% GST', null),
  ('sk-loansubsidy-02', 'Loan + Subsidy', 2, 'National Agri Infra Financing Facility - NAIFF', 'Up to 2 CR Loan
Interest Subvention: 3%
ROI: Approx 9%
Re-payment period: 7 years including 2 years moratorium', 'Only New Agriculture projects can apply, like cold storage, primary processing, warehouse, custom hiring, green house, poly house, vertical farming, etc.
Land is mandatory own or on lease for 7 to 8 years', 'FPOs
Private companies
Individual entrepreneurs
Startup
MSMEs', 'Rolling basis', 'Department of Agriculture & Farmers Welfare', 'Government Scheme', 'Pan India', 'INR 30,000 + 18% GST', null),
  ('sk-loansubsidy-03', 'Loan + Subsidy', 3, 'Animal Husbandry Infrastructure Development Fund - AHIDF', 'Loan up to 90% of Projects
Interest Subvention: 3%
Credit Guarantee Coverage 25%
Re-payment period: 8 years including 2 years moratorium', 'Dairy processing
Value-addition Dairy product Manufacturing
Animal Feed Manufacturing units
Setting up of Veterinary Vaccine Manufacturing facilities
Animal Waste to Wealth Management', 'FPOs
Private companies
Individual entrepreneurs
Section 8 companies
MSMEs', 'Rolling basis', 'Department of animal husbandry and dairying', 'Government Scheme', 'Pan India', 'INR 30,000 + 18% GST', null),
  ('sk-loansubsidy-04', 'Loan + Subsidy', 4, 'NEEDS Scheme (TN)', '-Project cost should be above ₹10 lakh, and below ₹5 crore.
-Rate of interest applicable to Micro & Small enterprises as per banking norms.
-Subsidy assistance will be provided by the State Government up to 25% of the project cost (Subject to a maximum limit of ₹75 Lakhs).
-Interest subvention provided at the rate of 3%, throughout the period of repayment.', 'Manufacturing and service activities are eligible

Note: PFA Attached PDF for Ineligible Projects under NEEDS Yojana', 'Applicant should be a resident of Tamil Nadu State for not less than 3 years.
First Generation Individual Entrepreneur (Proprietorship) or Group of Entrepreneurs (Partnership).
Applicant should be a first-generation entrepreneur.
Entrepreneurship Development Programme (EDP) training is mandatory (1 Month).
Age of the applicant should be between 21 to 35 years in general and for special (Women/BC/MBC/SC/ST/Ex-servicemen/Transgender/Differently abled), age relaxation is up to 45 years.', 'Rolling basis', 'Govt. of TN', 'Government Scheme', 'Tamil Nadu', 'INR 20,000 + 18% GST', null),
  ('sk-loansubsidy-05', 'Loan + Subsidy', 5, 'PMFME - Prime Minister Micro Food Processing Enterprises', 'Credit-linked capital subsidy @35% of the eligible project cost -
maximum of Rs. 10.0 lakhs per unit for upgradation or
setting up of new units.

ROI & Tenure: Depend on bank and loan facility provider', 'Food Processing', 'Individuals / Proprietorship / Partnership/ FPOs/ NGOs/ Cooperatives/ SHGs/ Private Limited Company', 'Rolling basis', 'Ministry of Food Processing Industries', 'Government Scheme', 'Pan India', 'INR 20,000 + 18% GST', null),
  ('sk-loansubsidy-06', 'Loan + Subsidy', 6, 'Fisheries and Aquaculture Infrastructure Development Fund (FIDF)', 'Loan up to 80% of the project cost
Interest subvention: 3%

Maximum repayment period of 12 years inclusive of moratorium of 2 years
The land should be for Minimum of 12 years lease period (in case of lease)
Beneficiaries require to contribute min 20% of the project cost as margin money', 'Fisheries and Aquaculture Infrastructure

Detailed components are available in full proposal', '1. Private Companies/ Entrepreneurs
2. State Governments/Union Territories
3. State Owned Corporations/State Government Under taking/ Government Sponsored/ Supported Organizations
4. Fisheries Cooperative Federations (including FISHCOPPED etc.)
5. Cooperatives, collective groups of fish farmers & fish produce groups etc.
6. Panchayat Raj Institutions/ Self Help Groups (SHGs)/ NGOs
7. SCs/STs/Marginal Farmers, Women & Entrepreneurs, Self Help Groups and cooperatives of these etc.
8. Physically disabled
9. Any other Institution/ Entity to be decided by the Government', 'Rolling basis', 'The Department of Fisheries, Ministry of Fisheries, Animal Husbandry & Dairying, Government of India', 'Government Scheme', 'Pan India', 'INR 25,000 + 18% GST', null),
  ('sk-certgemaward-01', 'Certification / GeM / Award', 1, 'Tender through GeM', 'Wider Market Access
Enhance Transparency & Efficiency
Cost Savings
Real-Time Updates
Equal Opportunity
Ease of Use & Secure Transactions
Support for MSMEs and Startups
Policy Compliance
EMD exempt if have a DPIIT Certificate', 'All focus sectors', 'Registered Vendors
Local Suppliers
Startups
Registration on the GeM portal is a prerequisite for all entities to participate in tenders and procurement activities.', 'Rolling basis', 'GeM', '', 'Pan India', 'INR 15,000 + 18% GST', 'Our consultancy fees are for
above mentioned scope of
work and do not include
any government fees/charges.
Whatever fees for tender document
fee/processing fee, EMD, bid security,
courier charges or any other charges
will be paid by you (customer).'),
  ('sk-certgemaward-02', 'Certification / GeM / Award', 2, 'IEC Code', 'An Importer -Exporter Code (IEC) is a key business identification number which mandatory for export from India or Import to India. No export or import shall be made by any person without obtaining an IEC unless specifically exempted. For services exports however, IEC shall be not be necessary except when the service provider is taking benefits under the Foreign Trade Policy.', 'Importer -Exporter', '1. Proprietorship
2. Partnership
3. Limited Liability Partnership
4. Private Limited
5. Public Limited
6. Government Undertaking
7. Registered Society
8. Trust
9. HUF
10. One person company
11. Other', 'Rolling basis', 'MINISTRY OF COMMERCE AND INDUSTRY', '', 'Pan India', 'INR 5,000 + 18% GST', 'excluding the government
processing fee (500), the
government processing fee is not
included in our consultancy charge;
the government processing fee
needs to be paid by client at
scheme authorities.'),
  ('sk-certgemaward-03', 'Certification / GeM / Award', 3, 'Gobardhan Certificate', 'The registration number is required to avail benefits/ support from other Ministries/ Departments.
Like
Interest subvention -AHIDF
Interest subvention - Agri-Infra Fund
Central Financial Assistance (CFA)- Waste to Energy
Additional Central Assistance - Swachh Bharat Mission
bio-CNG/Compressed Bio Gas (CBG) offtake - (SATAT) Initiative
Swachh Bharat Mission (Gramin)
Market Development Assistance', 'biogas/ Compressed Bio Gas (CBG) / Bio CNG plant', 'Anyone who operates or intending to setup a biogas/ Compressed Bio Gas (CBG) / Bio CNG plant in India can obtain a gobardhan registration certificate by registering in this unified registration portal.', 'Rolling basis', 'MINISTRY OF JAL SHAKTI DEPARTMENT OF DRINKING WATER & SANITATION', '', 'Pan India', 'INR 5,000 + 18% GST', null)
on conflict (id) do nothing;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sales_kit') then
    alter publication supabase_realtime add table public.sales_kit;
  end if;
end $$;

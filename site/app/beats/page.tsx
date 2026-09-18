import { BeatsPage } from '@/components/lab/beats';
import { DataValidation } from '@/components/lab/research';
import report from '@/public/data/research-summary.json';
export const metadata = { title: 'Beats' };
export default function Page() { return <><BeatsPage /><DataValidation report={report} /></>; }

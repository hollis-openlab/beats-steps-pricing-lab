import { StepsPage } from '@/components/lab/steps';
import { DataValidation } from '@/components/lab/research';
import report from '@/public/data/research-summary.json';
export const metadata = { title: 'Steps' };
export default function Page() { return <><StepsPage /><DataValidation report={report} /></>; }

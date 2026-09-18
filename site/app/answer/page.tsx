import { redirect } from 'next/navigation';

export default function Page() {
  redirect(`/docs/${encodeURIComponent('正式提交答案.md')}`);
}

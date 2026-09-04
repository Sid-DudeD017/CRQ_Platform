import Link from 'next/link';

export default function NotFound() {
    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6 gap-4">
            <span className="material-symbols-outlined text-[64px] text-primary">error_outline</span>
            <h2 className="font-headline-md text-headline-md text-primary font-bold">404 - Page Not Found</h2>
            <p className="font-body-md text-on-surface-variant max-w-md">
                The requested cyber risk page or analysis view does not exist.
            </p>
            <Link
                href="/"
                className="mt-2 bg-primary text-on-primary px-5 py-2.5 rounded-lg font-body-sm font-semibold hover:opacity-90 transition-opacity"
            >
                Return to Executive Dashboard
            </Link>
        </div>
    );
}

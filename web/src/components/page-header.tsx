type PageHeaderProps = {
  title: string
  caption: string
}

export function PageHeader({ title, caption }: PageHeaderProps) {
  return (
    <header>
      <h2 className="text-lg font-semibold tracking-tight text-white dark:text-cobalt">{title}</h2>
      <p className="text-sm text-white/70 dark:text-cobalt/70">{caption}</p>
    </header>
  )
}

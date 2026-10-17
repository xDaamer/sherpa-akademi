import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { HeroSection } from '../components/HeroSection';
import { TrustBar } from '../components/TrustBar';
import { PackagesSection } from '../components/PackagesSection';
import { WhyUsSection } from '../components/WhyUsSection';
import { SubjectsSection } from '../components/SubjectsSection';
import { TestimonialsSection } from '../components/TestimonialsSection';
import { FAQSection } from '../components/FAQSection';
import { PageMeta, seoPage } from '../components/PageMeta';

const page = seoPage('home');

interface HomePageProps {
  onOpenTrialForm: () => void;
}

export const HomePage: React.FC<HomePageProps> = ({ onOpenTrialForm }) => {
  const location = useLocation();

  // Scroll to a section if navigated here from another page via the header/footer links.
  useEffect(() => {
    const scrollTo = (location.state as { scrollTo?: string } | null)?.scrollTo;
    if (scrollTo) {
      const element = document.getElementById(scrollTo);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [location.state]);

  return (
    <main className="flex-grow">
      {/* Yasal sayfadan ana sayfaya dönüldüğünde <head>'in ana sayfaya ait
          değerlere geri dönmesi için burada da gerekli — React 19 en son
          render edilen etiketi uygular. */}
      <PageMeta
        title={page.title}
        description={page.description}
        path={page.path}
      />
      <HeroSection onOpenTrialForm={onOpenTrialForm} />
      <TrustBar />
      <PackagesSection onOpenTrialForm={onOpenTrialForm} />
      <WhyUsSection onOpenTrialForm={onOpenTrialForm} />
      <SubjectsSection />
      <TestimonialsSection />
      <FAQSection />
    </main>
  );
};

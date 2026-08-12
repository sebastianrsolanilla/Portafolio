const hero = document.querySelector(".hero");
const title = document.querySelector("#hero-title");

if (hero && title) {
  let ticking = false;

  function updateTitleSeparation() {
    const distance = Math.max(hero.offsetHeight * 0.72, 1);

    const progress = Math.min(
      Math.max(-hero.getBoundingClientRect().top / distance, 0),
      1
    );

    const maxSeparation = window.innerWidth * 0.12;

    title.style.setProperty(
      "--hero-separation",
      `${progress * maxSeparation}px`
    );

    ticking = false;
  }

  function requestUpdate() {
    if (!ticking) {
      window.requestAnimationFrame(updateTitleSeparation);
      ticking = true;
    }
  }

  window.addEventListener("scroll", requestUpdate, {
    passive: true
  });

  window.addEventListener("resize", requestUpdate);

  title.addEventListener(
    "animationend",
    () => {
      title.classList.add("hero-intro-done");
      updateTitleSeparation();
    },
    { once: true }
  );

  updateTitleSeparation();
}

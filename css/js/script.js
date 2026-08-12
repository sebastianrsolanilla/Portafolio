const hero = document.querySelector(".hero");
const title = document.querySelector("#hero-title");

if (hero && title) {
  const firstLine = title.querySelector("span:first-child");
  const secondLine = title.querySelector("span:last-child");

  function updateTitleSeparation() {
    const distance = Math.max(hero.offsetHeight * 0.8, 1);

    const progress = Math.min(
      Math.max(window.scrollY / distance, 0),
      1
    );

    const separation = progress * window.innerWidth * 0.14;

    firstLine.style.transform =
      `translateX(calc(-10% - ${separation}px))`;

    secondLine.style.transform =
      `translateX(calc(10% + ${separation}px))`;
  }

  window.addEventListener("scroll", updateTitleSeparation, {
    passive: true
  });

  window.addEventListener("resize", updateTitleSeparation);

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
